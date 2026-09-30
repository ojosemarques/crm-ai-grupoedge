import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { acquisitionConnectionCommandSchema, acquisitionConnectionSchema, ACQUISITION_CONTRACT_VERSION } from "@/modules/acquisition-api/domain/acquisition-contracts";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { META_ADS_DEFAULT_API_VERSION } from "@/modules/integrations/domain/meta-ads-contracts";

function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export function createAcquisitionConnectionService(database: PrismaClient, secrets: SecretResolver = environmentSecretResolver) {
  const authorization = getAuthorizationService();
  async function configure(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_SECRETS_MANAGE, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });
    const input = acquisitionConnectionSchema.parse(raw);
    return database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`acquisition:${context.workspaceId}:${input.key}`}, 0))`;
      if (await tx.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } })) fail("Já existe uma conexão com esta chave.", "ACQUISITION_CONNECTION_CONFLICT");
      const source = await tx.leadSource.findFirst({ where: { workspaceId: context.workspaceId, key: input.sourceKey, deletedAt: null } }); if (!source) fail("Origem não encontrada.", "ACQUISITION_SOURCE_NOT_FOUND", 422);
      const config = { provider: input.provider, sourceKey: input.sourceKey, retry: { maxAttempts: 5, strategy: "EXPONENTIAL_CAPPED" }, ordering: "EXTERNAL_OCCURRED_AT", mappingVersion: 1, ...(input.provider === "META_LEAD_ADS" ? { graphApiVersion: META_ADS_DEFAULT_API_VERSION } : {}) };
      const connection = await tx.integrationConnection.create({ data: { workspaceId: context.workspaceId, key: input.key, providerKey: input.provider, adapterKey: `acquisition-${input.provider.toLocaleLowerCase().replaceAll("_", "-")}-v1`, displayName: input.displayName, environment: "PRODUCTION", status: "AWAITING_CREDENTIAL", capabilityLevel: "IMPLEMENTED", enabled: false, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, version: 1, schemaVersion: ACQUISITION_CONTRACT_VERSION, config: json(config), configHash: sha256(canonicalJson(config)), createdByActorId: context.actorId } });
      await tx.integrationConnectionCapability.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, capability: "WEBHOOK_RECEIVE" } });
      await tx.integrationSecretReference.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, alias: "webhook-hmac", referenceKey: input.secretReferenceKey, present: false, createdByActorId: context.actorId } });
      if (input.verificationTokenReferenceKey) await tx.integrationSecretReference.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, alias: "webhook-verify-token", referenceKey: input.verificationTokenReferenceKey, present: false, createdByActorId: context.actorId } });
      if (input.enrichmentTokenReferenceKey) await tx.integrationSecretReference.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, alias: "lead-enrichment-token", referenceKey: input.enrichmentTokenReferenceKey, present: false, createdByActorId: context.actorId } });
      const mapping = json(input.mapping); await tx.integrationFieldMappingVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, objectType: "lead", version: 1, schemaVersion: ACQUISITION_CONTRACT_VERSION, mapping, precedence: json({ policy: "HUMAN_WINS", humanFields: Object.keys(input.mapping), externalFields: [] }), configHash: sha256(canonicalJson(mapping)), active: true, createdByActorId: context.actorId } });
      let formId: string | null = null; let landingPageId: string | null = null;
      if (input.provider === "LANDING_PAGE") { const landing = await tx.landingPage.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.definition!.name, canonicalUrl: input.definition!.canonicalUrl!, status: "ACTIVE", createdByActorId: context.actorId, updatedByActorId: context.actorId } }); landingPageId = landing.id; await tx.landingPageVersion.create({ data: { workspaceId: context.workspaceId, landingPageId: landing.id, version: 1, canonicalUrl: landing.canonicalUrl, title: input.definition?.title ?? null, schemaVersion: ACQUISITION_CONTRACT_VERSION, definition: json({ connectionId: connection.id, mappingVersion: 1 }), createdByActorId: context.actorId } }); }
      if (input.provider === "FORM" || input.provider === "LANDING_PAGE") { const form = await tx.marketingForm.create({ data: { workspaceId: context.workspaceId, key: `${input.key}-form`, name: input.definition?.name ?? input.displayName, status: "ACTIVE", createdByActorId: context.actorId, updatedByActorId: context.actorId } }); formId = form.id; await tx.marketingFormVersion.create({ data: { workspaceId: context.workspaceId, marketingFormId: form.id, landingPageId, version: 1, schemaVersion: ACQUISITION_CONTRACT_VERSION, definition: json({ connectionId: connection.id, mappingVersion: 1, fields: Object.keys(input.mapping) }), createdByActorId: context.actorId } }); }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "acquisition.connection.configured", entityType: "IntegrationConnection", entityId: connection.id, changes: json({ provider: input.provider, mappingVersion: 1, secretReference: input.secretReferenceKey, formId, landingPageId }) } });
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { slug: true } });
      return { id: connection.id, key: connection.key, provider: input.provider, status: connection.status, mappingVersion: 1, formId, landingPageId, webhookPath: `/api/acquisition/${workspace.slug}/${connection.key}/webhook`, secretStored: false, secretReference: input.secretReferenceKey };
    });
  }
  async function command(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });
    const input = acquisitionConnectionCommandSchema.parse(raw);
    return database.$transaction(async (tx) => {
      const current = await tx.integrationConnection.findFirst({ where: { id: input.connectionId, workspaceId: context.workspaceId, providerKey: { in: ["FORM", "LANDING_PAGE", "META_LEAD_ADS", "TYPEFORM"] } }, include: { secrets: { where: { disabledAt: null }, orderBy: { version: "desc" } } } });
      if (!current) fail("Conexão não encontrada.", "ACQUISITION_CONNECTION_NOT_FOUND", 404);
      if (current.revision !== input.revision) fail("Conexão desatualizada.", "ACQUISITION_REVISION_CONFLICT");
      if (input.action === "ACTIVATE") {
        const reference = current.secrets.find((item) => item.alias === "webhook-hmac"); const secret = reference ? await secrets.resolve(reference.referenceKey) : null; if (!reference || !secret) fail("A referência de assinatura ainda não resolve um segredo.", "ACQUISITION_SECRET_UNAVAILABLE", 422);
        if (current.providerKey === "META_LEAD_ADS") { const verification = current.secrets.find((item) => item.alias === "webhook-verify-token"); const enrichment = current.secrets.find((item) => item.alias === "lead-enrichment-token"); if (!verification || !(await secrets.resolve(verification.referenceKey)) || !enrichment || !(await secrets.resolve(enrichment.referenceKey))) fail("Verify token ou token de enriquecimento Meta indisponível.", "PROVIDER_GATE_NOT_VALIDATED", 422); }
        const resolvedIds: string[] = []; for (const item of current.secrets) if (await secrets.resolve(item.referenceKey)) resolvedIds.push(item.id); await tx.integrationSecretReference.updateMany({ where: { workspaceId: context.workspaceId, id: { in: resolvedIds } }, data: { present: true, rotatedByActorId: context.actorId, rotatedAt: new Date() } });
        const updated = await tx.integrationConnection.update({ where: { id: current.id }, data: { status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, revision: { increment: 1 }, lastTestedAt: new Date(), updatedByActorId: context.actorId } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "acquisition.connection.activated", entityType: "IntegrationConnection", entityId: current.id, changes: json({ secretReferenceResolved: true, signatureGateEnabled: true, externalProviderValidated: false, externalCredentialStored: false }) } }); return updated;
      }
      if (input.action === "REVOKE") {
        await tx.integrationSecretReference.updateMany({ where: { workspaceId: context.workspaceId, connectionId: current.id, disabledAt: null }, data: { present: false, disabledAt: new Date(), rotatedByActorId: context.actorId, rotatedAt: new Date() } });
        const updated = await tx.integrationConnection.update({ where: { id: current.id }, data: { status: "PAUSED", enabled: false, revision: { increment: 1 }, updatedByActorId: context.actorId } }); await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "acquisition.connection.revoked", entityType: "IntegrationConnection", entityId: current.id, reason: input.reason } }); return updated;
      }
      const latest = await tx.integrationFieldMappingVersion.findFirst({ where: { workspaceId: context.workspaceId, connectionId: current.id, objectType: "lead" }, orderBy: { version: "desc" } }); if (!latest) fail("Mapeamento não encontrado.", "ACQUISITION_MAPPING_NOT_FOUND", 404);
      const nextMapping = input.action === "UPDATE_MAPPING" ? input.mapping : (await tx.integrationFieldMappingVersion.findFirst({ where: { workspaceId: context.workspaceId, connectionId: current.id, objectType: "lead", version: input.targetVersion } }))?.mapping;
      if (!nextMapping) fail("Versão de mapeamento não encontrada.", "ACQUISITION_MAPPING_NOT_FOUND", 404);
      const version = latest.version + 1; const value = json(nextMapping);
      const created = await tx.integrationFieldMappingVersion.create({ data: { workspaceId: context.workspaceId, connectionId: current.id, objectType: "lead", version, schemaVersion: ACQUISITION_CONTRACT_VERSION, mapping: value, precedence: json(latest.precedence), configHash: sha256(canonicalJson(value)), active: true, createdByActorId: context.actorId } });
      await tx.integrationConnection.update({ where: { id: current.id }, data: { revision: { increment: 1 }, updatedByActorId: context.actorId } }); await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.action === "UPDATE_MAPPING" ? "acquisition.mapping.versioned" : "acquisition.mapping.rolled_back", entityType: "IntegrationFieldMappingVersion", entityId: created.id, reason: input.action === "ROLLBACK_MAPPING" ? input.reason : null, changes: json({ version, sourceVersion: input.action === "ROLLBACK_MAPPING" ? input.targetVersion : null }) } }); return { connectionId: current.id, mappingVersion: version, revision: current.revision + 1 };
    });
  }
  return Object.freeze({ configure, command });
}
let singleton: ReturnType<typeof createAcquisitionConnectionService> | undefined;
export function getAcquisitionConnectionService() { singleton ??= createAcquisitionConnectionService(getDatabaseClient()); return singleton; }
