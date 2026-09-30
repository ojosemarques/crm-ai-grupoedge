import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import {
  EMAIL_ADAPTER_KEY,
  EMAIL_CONTRACT_VERSION,
  EMAIL_PROVIDER_KEY,
  emailConfigureLocalSchema,
  emailLocalInboundSchema,
  emailLocalStatusSchema,
} from "@/modules/integrations/domain/email-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = Readonly<{ database: PrismaClient; now: () => Date; omnichannel?: ReturnType<typeof getOmnichannelService> }>;

function fail(message: string, code: string, statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

const resource = (context: AuthenticatedContext) => ({ workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });

export function createEmailService(options: Options) {
  const authorization = getAuthorizationService();
  const omnichannel = options.omnichannel ?? getOmnichannelService();

  async function profile(context: AuthenticatedContext) {
    return options.database.emailConnectionProfile.findFirst({
      where: { workspaceId: context.workspaceId },
      include: {
        connection: { include: { secrets: { where: { disabledAt: null }, orderBy: { alias: "asc" } } } },
        observations: { orderBy: { observedAt: "desc" }, take: 1 },
      },
    });
  }

  async function screen(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EMAIL_READ, resource(context));
    const current = await profile(context);
    const [statusGroups, suppressions, reviews, messages, canConfigure, canPause, canTest, canManageSuppression] = await Promise.all([
      options.database.message.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, conversation: { channel: "EMAIL" } }, _count: { _all: true } }),
      options.database.emailSuppression.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }], take: 25 }),
      options.database.emailEventReview.findMany({ where: { workspaceId: context.workspaceId, status: "OPEN" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 }),
      options.database.message.findMany({ where: { workspaceId: context.workspaceId, conversation: { channel: "EMAIL" } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 25, select: { id: true, subject: true, status: true, direction: true, occurredAt: true, isSimulated: true, conversation: { select: { opportunity: { select: { id: true, name: true } } } }, emailProfile: { select: { messageIdHeader: true, inReplyToHeader: true } } } }),
      authorization.authorize(context, PermissionKeys.INTEGRATIONS_EMAIL_CONFIGURE, resource(context)),
      authorization.authorize(context, PermissionKeys.INTEGRATIONS_EMAIL_PAUSE, resource(context)),
      authorization.authorize(context, PermissionKeys.INTEGRATIONS_EMAIL_TEST_LOCAL, resource(context)),
      authorization.authorize(context, PermissionKeys.EMAIL_SUPPRESSION_MANAGE, resource(context)),
    ]);
    const count = (status: string) => statusGroups.find((item) => item.status === status)?._count._all ?? 0;
    return {
      generatedAt: options.now().toISOString(),
      activationStatus: !current ? "CONFIGURATION_INCOMPLETE" as const : current.operatingMode === "PAUSED" ? "PAUSED" as const : current.operatingMode === "LOCAL_SINK" ? "LOCAL_SIMULATOR" as const : current.operatingMode === "EXTERNAL_READY" ? "READY_FOR_EXTERNAL_HOMOLOGATION" as const : "EXTERNAL_DISABLED" as const,
      externalEgress: false,
      externalValidationDeferred: true,
      profile: current ? {
        id: current.id, revision: current.connection.revision, operatingMode: current.operatingMode, displayName: current.displayName,
        senderAddress: current.senderAddress, replyTo: current.replyTo, envelopeFrom: current.envelopeFrom, domain: current.domain,
        spfStatus: current.spfStatus, dkimStatus: current.dkimStatus, dmarcStatus: current.dmarcStatus,
        domainStatusProvenance: current.domainStatusProvenance, configuredAt: current.configuredAt?.toISOString() ?? null,
        secrets: current.connection.secrets.map((item) => ({ alias: item.alias, referenceKey: item.referenceKey, present: item.present })),
        latestObservation: current.observations[0] ? { ...current.observations[0], observedAt: current.observations[0].observedAt.toISOString(), createdAt: current.observations[0].createdAt.toISOString() } : null,
      } : null,
      metrics: { queued: count("QUEUED"), accepted: count("PROVIDER_ACCEPTED"), sent: count("SENT"), delivered: count("DELIVERED"), deferred: count("DEFERRED"), softBounce: count("SOFT_BOUNCE"), hardBounce: count("HARD_BOUNCE"), complaint: count("COMPLAINT"), replies: count("REPLIED"), unsubscribed: count("UNSUBSCRIBED"), denominator: statusGroups.reduce((sum, item) => sum + item._count._all, 0) },
      suppressions: suppressions.map((item) => ({ ...item, normalizedEmail: item.normalizedEmail.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2"), effectiveAt: item.effectiveAt.toISOString(), createdAt: item.createdAt.toISOString() })),
      reviews: reviews.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null })),
      messages: messages.map(({ conversation, ...item }) => ({ ...item, opportunityId: conversation.opportunity?.id ?? null, opportunityName: conversation.opportunity?.name ?? null, occurredAt: item.occurredAt.toISOString() })),
      permissions: { configure: canConfigure.allowed, pause: canPause.allowed, testLocal: canTest.allowed, manageSuppression: canManageSuppression.allowed },
      checklist: ["Escolher e homologar provider", "Configurar domínio real", "Validar SPF, DKIM e DMARC externamente", "Adicionar secret refs no servidor", "Homologar webhook e replies reais"],
    };
  }

  async function configureLocal(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EMAIL_CONFIGURE, resource(context));
    await authorization.assertAuthorized(context, PermissionKeys.EMAIL_SENDER_MANAGE, resource(context));
    const input = emailConfigureLocalSchema.parse(raw);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-config:${context.workspaceId}`}, 0))`;
      const connection = await tx.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "email-local-sink" } } });
      if (!connection) fail("Fundação local de e-mail ausente. Execute o seed.", "EMAIL_LOCAL_FOUNDATION_MISSING", 409);
      if (input.revision && input.revision !== connection.revision) fail("A configuração foi alterada. Atualize a página.", "EMAIL_CONFIGURATION_CONFLICT", 409);
      const domain = input.senderAddress.split("@")[1]!;
      const current = await tx.emailConnectionProfile.findUnique({ where: { workspaceId_connectionId: { workspaceId: context.workspaceId, connectionId: connection.id } } });
      const result = current ? await tx.emailConnectionProfile.update({ where: { id: current.id }, data: { displayName: input.displayName, senderAddress: input.senderAddress, senderAddressNormalized: input.senderAddress, envelopeFrom: input.senderAddress, replyTo: input.replyTo ?? null, domain, operatingMode: "LOCAL_SINK", configuredAt: now, updatedByActorId: context.actorId } }) : await tx.emailConnectionProfile.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, displayName: input.displayName, senderAddress: input.senderAddress, senderAddressNormalized: input.senderAddress, envelopeFrom: input.senderAddress, replyTo: input.replyTo ?? null, domain, operatingMode: "LOCAL_SINK", configuredAt: now, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      const nextVersion = connection.currentConfigVersion + 1;
      const config = { displayName: input.displayName, senderAddress: input.senderAddress, replyTo: input.replyTo ?? null, domain, operatingMode: "LOCAL_SINK", externalEgress: false };
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, version: nextVersion, schemaVersion: EMAIL_CONTRACT_VERSION, config, configHash: sha256(canonicalJson(config)), createdByActorId: context.actorId } });
      await tx.integrationConnection.update({ where: { id: connection.id }, data: { providerKey: EMAIL_PROVIDER_KEY, adapterKey: EMAIL_ADAPTER_KEY, displayName: "E-mail — sink local", status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, currentConfigVersion: nextVersion, revision: { increment: 1 }, lastTestedAt: now, lastSucceededAt: now, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.email.local_configured", entityType: "EmailConnectionProfile", entityId: result.id, changes: { senderDomain: domain, replyToConfigured: Boolean(input.replyTo), secretValuesStored: false, externalEgress: false } } });
      return { id: result.id, operatingMode: result.operatingMode, externalEgress: false };
    });
  }

  async function setPaused(context: AuthenticatedContext, paused: boolean, revision: number) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EMAIL_PAUSE, resource(context));
    const current = await profile(context);
    if (!current) fail("Perfil de e-mail não configurado.", "EMAIL_PROFILE_MISSING", 404);
    if (current.connection.revision !== revision) fail("A configuração foi alterada. Atualize a página.", "EMAIL_CONFIGURATION_CONFLICT", 409);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.integrationConnection.updateMany({ where: { id: current.connectionId, workspaceId: context.workspaceId, revision }, data: { enabled: !paused, status: paused ? "PAUSED" : "ACTIVE_LOCAL", revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (changed.count !== 1) fail("A configuração foi alterada. Atualize a página.", "EMAIL_CONFIGURATION_CONFLICT", 409);
      const updated = await tx.emailConnectionProfile.update({ where: { id: current.id }, data: { operatingMode: paused ? "PAUSED" : "LOCAL_SINK", pausedReason: paused ? "Pausa manual autorizada." : null, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: paused ? "integration.email.paused" : "integration.email.resumed_local", entityType: "EmailConnectionProfile", entityId: current.id, changes: { operatingMode: updated.operatingMode, externalEgress: false } } });
      return { operatingMode: updated.operatingMode, externalEgress: false };
    });
  }

  async function simulateInbound(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EMAIL_TEST_LOCAL, resource(context));
    const input = emailLocalInboundSchema.parse(raw);
    return omnichannel.receiveLocal(context, { externalEventId: input.externalEventId, channel: "EMAIL", address: input.from, body: input.text, subject: input.subject, occurredAt: input.occurredAt, scenario: input.inReplyTo ? "REPLY" : "RECEIVED", messageIdHeader: input.messageId, inReplyToHeader: input.inReplyTo ?? null, referenceHeaders: input.references });
  }

  async function simulateStatus(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EMAIL_TEST_LOCAL, resource(context));
    const input = emailLocalStatusSchema.parse(raw);
    return omnichannel.simulateDelivery(context, { messageId: input.messageId, externalEventId: input.externalEventId, scenario: input.status });
  }

  async function applyLocalSuppression(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.EMAIL_SUPPRESSION_MANAGE, resource(context));
    const input = emailLocalInboundSchema.pick({ from: true, externalEventId: true }).extend({ reasonCode: emailLocalStatusSchema.shape.status.extract(["HARD_BOUNCE", "COMPLAINT"]) }).parse(raw);
    const now = options.now();
    const point = await options.database.contactPoint.findFirst({ where: { workspaceId: context.workspaceId, type: "EMAIL", normalizedValue: input.from, deletedAt: null } });
    return options.database.$transaction(async (tx) => {
      const existing = await tx.emailSuppression.findUnique({ where: { workspaceId_purposeKey_normalizedEmail_externalEventId: { workspaceId: context.workspaceId, purposeKey: "legacy-commercial-contact", normalizedEmail: input.from, externalEventId: input.externalEventId } } });
      if (existing) return { id: existing.id, idempotent: true };
      const created = await tx.emailSuppression.create({ data: { workspaceId: context.workspaceId, contactPointId: point?.id ?? null, normalizedEmail: input.from, purposeKey: "legacy-commercial-contact", action: "APPLIED", reasonCode: input.reasonCode, source: "LOCAL_SIMULATOR", externalEventId: input.externalEventId, effectiveAt: now, createdByActorId: context.actorId } });
      if (point) await tx.contactPoint.update({ where: { id: point.id }, data: { doNotContact: true, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "email.suppression.applied_local", entityType: "EmailSuppression", entityId: created.id, changes: { addressHash: createHash("sha256").update(input.from).digest("hex"), reasonCode: input.reasonCode, externalEgress: false } } });
      return { id: created.id, idempotent: false };
    });
  }

  return Object.freeze({ screen, configureLocal, setPaused, simulateInbound, simulateStatus, applyLocalSuppression });
}

let service: ReturnType<typeof createEmailService> | undefined;
export function getEmailService() { service ??= createEmailService({ database: getDatabaseClient(), now: () => new Date() }); return service; }
