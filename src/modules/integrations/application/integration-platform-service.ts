import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { integrationAdapterRegistry, IntegrationAdapterRegistry } from "@/modules/integrations/application/integration-adapter-registry";
import {
  LOCAL_MOCK_ADAPTER_KEY,
  LOCAL_MOCK_PROVIDER_KEY,
  createConnectionSchema,
  updateConnectionSchema,
  fieldMappingVersionSchema,
  mappingInputSchema,
  resolveMappingConflictSchema,
} from "@/modules/integrations/domain/integration-contracts";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { canonicalJson, redactSensitive, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{
  database: PrismaClient;
  adapters: IntegrationAdapterRegistry;
  now: () => Date;
}>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue;
}

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function workspaceResource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId };
}

async function audit(
  tx: Tx,
  context: AuthenticatedContext,
  input: Readonly<{ action: string; entityType: string; entityId: string; reason?: string; changes?: unknown; requestId?: string }>,
) {
  await tx.auditLog.create({
    data: {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      changes: input.changes === undefined ? Prisma.JsonNull : json(input.changes),
    },
  });
}

function safeConnectionDto(connection: {
  id: string;
  key: string;
  providerKey: string;
  adapterKey: string;
  displayName: string;
  environment: string;
  status: string;
  capabilityLevel: string;
  revision: number;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastSucceededAt: Date | null;
  lastErroredAt: Date | null;
  currentErrorClass: string | null;
  currentErrorCode: string | null;
  currentErrorMessage: string | null;
  capabilities: ReadonlyArray<{ capability: string; enabled: boolean }>;
  secrets: ReadonlyArray<{ alias: string; version: number; present: boolean; createdAt: Date; rotatedAt: Date | null }>;
}) {
  return {
    id: connection.id,
    key: connection.key,
    providerKey: connection.providerKey,
    adapterKey: connection.adapterKey,
    displayName: connection.displayName,
    environment: connection.environment,
    status: connection.status,
    capabilityLevel: connection.capabilityLevel,
    revision: connection.revision,
    enabled: connection.enabled,
    lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
    lastSucceededAt: connection.lastSucceededAt?.toISOString() ?? null,
    lastErroredAt: connection.lastErroredAt?.toISOString() ?? null,
    error: connection.currentErrorCode
      ? {
          classification: connection.currentErrorClass,
          code: connection.currentErrorCode,
          message: connection.currentErrorMessage ?? "Falha controlada.",
        }
      : null,
    capabilities: connection.capabilities.filter((item) => item.enabled).map((item) => item.capability),
    secretReferences: connection.secrets.map((secret) => ({
      alias: secret.alias,
      version: secret.version,
      present: secret.present,
      createdAt: secret.createdAt.toISOString(),
      rotatedAt: secret.rotatedAt?.toISOString() ?? null,
    })),
  };
}

const connectionInclude = {
  capabilities: { orderBy: { capability: "asc" as const } },
  secrets: { where: { disabledAt: null }, orderBy: { version: "desc" as const } },
} as const;

export async function createOutboxEventInTransaction(
  tx: Tx,
  input: Readonly<{
    workspaceId: string;
    connectionId?: string | null;
    actorId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string | null;
    idempotencyKey: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
) {
  const minimized = json(input.payload);
  return tx.outboxEvent.create({
    data: {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId ?? null,
      eventType: input.eventType,
      eventVersion: "1.0",
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: minimized,
      payloadHash: sha256(canonicalJson(minimized)),
      createdByActorId: input.actorId,
    },
  });
}

export function createIntegrationPlatformService(options: Options) {
  const authorization = getAuthorizationService();

  async function authorize(context: AuthenticatedContext, permission: (typeof PermissionKeys)[keyof typeof PermissionKeys]) {
    await authorization.assertAuthorized(context, permission, workspaceResource(context));
  }

  async function findConnection(context: AuthenticatedContext, connectionId: string) {
    const connection = await options.database.integrationConnection.findFirst({
      where: { id: connectionId, workspaceId: context.workspaceId },
      include: connectionInclude,
    });
    if (!connection) fail("Conexão não encontrada neste workspace.", "INTEGRATION_CONNECTION_NOT_FOUND", 404);
    return connection;
  }

  async function assertInternalEntity(workspaceId: string, type: string, id: string) {
    const delegates: Record<string, () => Promise<unknown>> = {
      CONTACT: () => options.database.contact.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
      ACCOUNT: () => options.database.account.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
      LEAD: () => options.database.lead.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
      OPPORTUNITY: () => options.database.opportunity.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
      MEETING: () => options.database.meeting.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
      MESSAGE: () => options.database.message.findFirst({ where: { workspaceId, id, deletedAt: null }, select: { id: true } }),
    };
    if (!await delegates[type]?.()) fail("Entidade interna não encontrada neste workspace.", "INTEGRATION_INTERNAL_ENTITY_NOT_FOUND", 404);
  }

  async function list(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_READ);
    const connections = await options.database.integrationConnection.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ status: "asc" }, { displayName: "asc" }],
      include: connectionInclude,
    });
    const grouped = await options.database.integrationConnection.groupBy({
      by: ["status"],
      where: { workspaceId: context.workspaceId },
      _count: { _all: true },
    });
    return {
      capabilityCeiling: "VALIDATED_LOCALLY" as const,
      externalEgress: false as const,
      generatedAt: options.now().toISOString(),
      summary: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
      connections: connections.map(safeConnectionDto),
    };
  }

  async function assertCanExecute(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
  }

  async function detail(context: AuthenticatedContext, connectionId: string) {
    await authorize(context, PermissionKeys.INTEGRATIONS_READ);
    await authorize(context, PermissionKeys.INTEGRATIONS_RUNS_READ);
    const connection = await findConnection(context, connectionId);
    const [runs, inbox, outbox, mappings, conflicts] = await Promise.all([
      options.database.integrationSyncRun.findMany({ where: { workspaceId: context.workspaceId, connectionId }, orderBy: { createdAt: "desc" }, take: 25 }),
      options.database.webhookInbox.findMany({ where: { workspaceId: context.workspaceId, connectionId }, orderBy: { receivedAt: "desc" }, take: 25, select: { id: true, providerEventId: true, eventType: true, status: true, signatureStatus: true, receivedAt: true, processedAt: true, attempts: true, errorCode: true, errorMessage: true, correlationId: true } }),
      options.database.outboxEvent.findMany({ where: { workspaceId: context.workspaceId, connectionId }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, eventType: true, status: true, attempts: true, errorCode: true, errorMessage: true, createdAt: true, deliveredLocallyAt: true, correlationId: true } }),
      options.database.externalObjectMapping.findMany({ where: { workspaceId: context.workspaceId, connectionId }, orderBy: { updatedAt: "desc" }, take: 25 }),
      options.database.externalMappingConflict.findMany({ where: { workspaceId: context.workspaceId, connectionId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 25 }),
    ]);
    return {
      connection: safeConnectionDto(connection),
      runs,
      inbox,
      outbox,
      mappings,
      conflicts,
      facts: ["Adaptador local", "Nenhum egress externo"],
      inferences: [] as string[],
      missingInformation: connection.secrets.some((secret) => !secret.present) ? ["referência de segredo presente"] : [],
    };
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const input = createConnectionSchema.parse(raw);
    const adapter = options.adapters.get(LOCAL_MOCK_ADAPTER_KEY);
    const config = adapter.validateConfiguration(input.config);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-connection:${context.workspaceId}:${input.key}`}, 0))`;
      if (await tx.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } })) {
        fail("Já existe uma conexão com esta chave.", "INTEGRATION_CONNECTION_CONFLICT");
      }
      const configJson = json(config);
      const connection = await tx.integrationConnection.create({
        data: {
          workspaceId: context.workspaceId,
          key: input.key,
          providerKey: LOCAL_MOCK_PROVIDER_KEY,
          adapterKey: LOCAL_MOCK_ADAPTER_KEY,
          displayName: input.displayName,
          environment: "LOCAL",
          status: "READY_FOR_LOCAL_TEST",
          capabilityLevel: "IMPLEMENTED",
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });
      await tx.integrationConnectionConfigVersion.create({
        data: {
          workspaceId: context.workspaceId,
          connectionId: connection.id,
          version: 1,
          schemaVersion: "1.0",
          config: configJson,
          configHash: sha256(canonicalJson(configJson)),
          createdByActorId: context.actorId,
        },
      });
      await tx.integrationConnectionCapability.createMany({
        data: adapter.capabilities.map((capability) => ({
          workspaceId: context.workspaceId,
          connectionId: connection.id,
          capability,
        })),
      });
      await audit(tx, context, { action: "integration.connection.created", entityType: "IntegrationConnection", entityId: connection.id, changes: { providerKey: LOCAL_MOCK_PROVIDER_KEY, environment: "LOCAL", capabilityLevel: "IMPLEMENTED" } });
      return safeConnectionDto(await tx.integrationConnection.findUniqueOrThrow({ where: { id: connection.id }, include: connectionInclude }));
    });
  }

  async function update(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const input = updateConnectionSchema.parse(raw);
    const config = options.adapters.get(LOCAL_MOCK_ADAPTER_KEY).validateConfiguration(input.config);
    return options.database.$transaction(async (tx) => {
      const current = await tx.integrationConnection.findFirst({ where: { id: input.connectionId, workspaceId: context.workspaceId } });
      if (!current) fail("Conexão não encontrada neste workspace.", "INTEGRATION_CONNECTION_NOT_FOUND", 404);
      if (current.revision !== input.revision) fail("A conexão foi alterada por outra pessoa. Atualize a página.", "INTEGRATION_REVISION_CONFLICT");
      if (current.adapterKey !== LOCAL_MOCK_ADAPTER_KEY || current.environment !== "LOCAL") fail("Somente a conexão local pode ser editada nesta fase.", "EXTERNAL_INTEGRATION_BLOCKED");
      const version = current.currentConfigVersion + 1;
      const configJson = json(config);
      const updated = await tx.integrationConnection.update({
        where: { id: current.id },
        data: { displayName: input.displayName, currentConfigVersion: version, revision: { increment: 1 }, status: "READY_FOR_LOCAL_TEST", capabilityLevel: "IMPLEMENTED", enabled: false, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, updatedByActorId: context.actorId },
      });
      await tx.integrationConnectionConfigVersion.create({
        data: {
          workspaceId: context.workspaceId,
          connectionId: current.id,
          version,
          schemaVersion: "1.0",
          config: configJson,
          configHash: sha256(canonicalJson(configJson)),
          createdByActorId: context.actorId,
        },
      });
      await audit(tx, context, { action: "integration.connection.updated", entityType: "IntegrationConnection", entityId: current.id, changes: { previousRevision: current.revision, revision: updated.revision, configVersion: version } });
      return safeConnectionDto(await tx.integrationConnection.findUniqueOrThrow({ where: { id: current.id }, include: connectionInclude }));
    });
  }

  async function linkSecretReference(context: AuthenticatedContext, raw: Readonly<{ connectionId: string; alias: string; referenceKey: string; present: boolean }>) {
    await authorize(context, PermissionKeys.INTEGRATIONS_SECRETS_MANAGE);
    const connection = await findConnection(context, raw.connectionId);
    if (connection.environment !== "LOCAL") fail("Referências externas não podem ser configuradas nesta fase.", "EXTERNAL_INTEGRATION_BLOCKED");
    return options.database.$transaction(async (tx) => {
      const previous = await tx.integrationSecretReference.findFirst({ where: { workspaceId: context.workspaceId, connectionId: connection.id, alias: raw.alias, disabledAt: null }, orderBy: { version: "desc" } });
      const now = options.now();
      if (previous) await tx.integrationSecretReference.update({ where: { id: previous.id }, data: { disabledAt: now, rotatedAt: now, rotatedByActorId: context.actorId } });
      const created = await tx.integrationSecretReference.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, alias: raw.alias, referenceKey: raw.referenceKey, version: (previous?.version ?? 0) + 1, present: raw.present, createdByActorId: context.actorId } });
      await audit(tx, context, { action: previous ? "integration.secret_reference.rotated" : "integration.secret_reference.linked", entityType: "IntegrationSecretReference", entityId: created.id, changes: { alias: created.alias, version: created.version, present: created.present } });
      return { alias: created.alias, version: created.version, present: created.present, createdAt: created.createdAt.toISOString() };
    });
  }

  async function testLocal(context: AuthenticatedContext, connectionId: string) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    const connection = await findConnection(context, connectionId);
    if (connection.environment !== "LOCAL") fail("Teste externo não é permitido nesta fase.", "EXTERNAL_INTEGRATION_BLOCKED");
    const version = await options.database.integrationConnectionConfigVersion.findUnique({ where: { workspaceId_connectionId_version: { workspaceId: context.workspaceId, connectionId, version: connection.currentConfigVersion } } });
    if (!version) fail("Configuração versionada não encontrada.", "INTEGRATION_CONFIG_NOT_FOUND");
    const adapter = options.adapters.get(connection.adapterKey);
    const now = options.now();
    try {
      const result = await adapter.testLocal(adapter.validateConfiguration(version.config));
      await options.database.$transaction(async (tx) => {
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, lastTestedAt: now, lastSucceededAt: now, lastErroredAt: null, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await audit(tx, context, { action: "integration.connection.tested_local", entityType: "IntegrationConnection", entityId: connection.id, changes: { capabilityLevel: "VALIDATED_LOCALLY", externalEgress: false } });
      });
      return result;
    } catch (error) {
      const failure = adapter.classifyError(error);
      await options.database.$transaction(async (tx) => {
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: failure.classification === "CONFIGURATION" ? "CONFIG_ERROR" : "DEGRADED", enabled: false, lastTestedAt: now, lastErroredAt: now, currentErrorClass: failure.classification, currentErrorCode: failure.code, currentErrorMessage: failure.safeMessage, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await audit(tx, context, { action: "integration.connection.test_failed", entityType: "IntegrationConnection", entityId: connection.id, changes: failure });
      });
      throw new ApplicationError(failure.safeMessage, { code: failure.code, statusCode: 409, expose: true });
    }
  }

  async function setPaused(context: AuthenticatedContext, connectionId: string, revision: number, paused: boolean) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const current = await findConnection(context, connectionId);
    if (current.revision !== revision) fail("A conexão foi alterada por outra pessoa. Atualize a página.", "INTEGRATION_REVISION_CONFLICT");
    if (!paused && current.capabilityLevel !== "VALIDATED_LOCALLY") fail("Teste local aprovado é obrigatório antes da ativação.", "LOCAL_TEST_REQUIRED");
    const updated = await options.database.$transaction(async (tx) => {
      const row = await tx.integrationConnection.update({ where: { id: connectionId }, data: { status: paused ? "PAUSED" : "ACTIVE_LOCAL", enabled: !paused, disabledAt: paused ? options.now() : null, revision: { increment: 1 }, updatedByActorId: context.actorId }, include: connectionInclude });
      await audit(tx, context, { action: paused ? "integration.connection.paused" : "integration.connection.activated_local", entityType: "IntegrationConnection", entityId: connectionId, changes: { enabled: !paused, capabilityLevel: row.capabilityLevel } });
      return row;
    });
    return safeConnectionDto(updated);
  }

  async function runSync(context: AuthenticatedContext, input: Readonly<{ connectionId: string; direction: "PULL" | "PUSH"; objectType: string; correlationId: string; leadId?: string }>) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    const connection = await findConnection(context, input.connectionId);
    if (!connection.enabled || connection.status !== "ACTIVE_LOCAL" || connection.capabilityLevel !== "VALIDATED_LOCALLY") fail("A conexão local precisa estar validada e ativa.", "INTEGRATION_NOT_READY");
    const adapter = options.adapters.get(connection.adapterKey);
    const version = await options.database.integrationConnectionConfigVersion.findUniqueOrThrow({ where: { workspaceId_connectionId_version: { workspaceId: context.workspaceId, connectionId: connection.id, version: connection.currentConfigVersion } } });
    const config = adapter.validateConfiguration(version.config);
    if (input.leadId) {
      const decision = await options.database.$transaction((tx) => evaluatePrivacyInTransaction(tx, { workspaceId: context.workspaceId, actorId: context.actorId, leadId: input.leadId!, channel: "OTHER", intendedAction: "INTEGRATION_SYNC" }));
      if (decision.outcome !== "ALLOW") fail("Sincronização bloqueada pela decisão de privacidade.", `PRIVACY_${decision.outcome}`);
    }
    const outcome = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-sync:${context.workspaceId}:${connection.id}:${input.direction}:${input.objectType}`}, 0))`;
      const cursor = await tx.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: connection.id, direction: input.direction, objectType: input.objectType } } });
      let run = await tx.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: connection.id, direction: input.direction, objectType: input.objectType, correlationId: input.correlationId } } });
      if (run?.status === "SUCCEEDED") return { failed: false as const, run };
      run ??= await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, direction: input.direction, objectType: input.objectType, status: "RUNNING", previousCursor: cursor?.cursor ?? null, correlationId: input.correlationId, executionMode: "LOCAL_MANUAL", requestedByActorId: context.actorId, startedAt: options.now(), attempts: 1 } });
      try {
        const result = input.direction === "PULL" ? await adapter.pullPage(config, cursor?.cursor ?? undefined) : await adapter.push(config, { objectType: input.objectType, cursor: cursor?.cursor ?? null });
        const finishedAt = options.now();
        const updated = await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", candidateCursor: result.nextCursor ?? cursor?.cursor ?? null, readCount: result.readCount ?? 0, createdCount: result.createdCount ?? 0, ignoredCount: result.ignoredCount ?? 0, finishedAt } });
        await tx.integrationSyncCursor.upsert({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: connection.id, direction: input.direction, objectType: input.objectType } }, create: { workspaceId: context.workspaceId, connectionId: connection.id, direction: input.direction, objectType: input.objectType, cursor: result.nextCursor ?? null, lastSyncRunId: run.id, updatedByActorId: context.actorId }, update: { cursor: result.nextCursor ?? cursor?.cursor ?? null, lastSyncRunId: run.id, version: { increment: 1 }, updatedByActorId: context.actorId } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, kind: "SYNC", syncRunId: run.id, attemptNumber: run.attempts, status: "SUCCEEDED", startedAt: run.startedAt ?? finishedAt, finishedAt, resultMetadata: json({ capabilityLevel: result.capabilityLevel, facts: result.facts }) } });
        await audit(tx, context, { action: "integration.sync.completed_local", entityType: "IntegrationSyncRun", entityId: run.id, requestId: input.correlationId, changes: { direction: input.direction, objectType: input.objectType, previousCursor: cursor?.cursor ?? null, candidateCursor: result.nextCursor ?? null, externalEgress: false } });
        return { failed: false as const, run: updated };
      } catch (error) {
        const failure = adapter.classifyError(error);
        const finishedAt = options.now();
        await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, failedCount: { increment: 1 }, finishedAt } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, kind: "SYNC", syncRunId: run.id, attemptNumber: run.attempts, status: "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, retryAfterSeconds: failure.retryAfterSeconds ?? null, startedAt: run.startedAt ?? finishedAt, finishedAt } });
        await audit(tx, context, { action: "integration.sync.failed_local", entityType: "IntegrationSyncRun", entityId: run.id, requestId: input.correlationId, changes: failure });
        return { failed: true as const, failure };
      }
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
    if (outcome.failed) throw new ApplicationError(outcome.failure.safeMessage, { code: outcome.failure.code, statusCode: 409, expose: true });
    return outcome.run;
  }

  async function recognizeMapping(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MAPPINGS_MANAGE);
    const input = mappingInputSchema.parse(raw);
    await findConnection(context, input.connectionId);
    await assertInternalEntity(context.workspaceId, input.internalEntityType, input.internalEntityId);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-mapping:${context.workspaceId}:${input.connectionId}:${input.externalObjectType}:${input.externalId}`}, 0))`;
      const existing = await tx.externalObjectMapping.findUnique({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: context.workspaceId, connectionId: input.connectionId, externalObjectType: input.externalObjectType, externalId: input.externalId } } });
      if (!existing) {
        const created = await tx.externalObjectMapping.create({ data: { workspaceId: context.workspaceId, connectionId: input.connectionId, externalObjectType: input.externalObjectType, externalId: input.externalId, internalEntityType: input.internalEntityType, internalEntityId: input.internalEntityId, externalVersion: input.externalVersion ?? null, externalHash: input.externalHash ?? null, firstRecognizedAt: options.now(), lastRecognizedAt: options.now(), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        await audit(tx, context, { action: "integration.mapping.created", entityType: "ExternalObjectMapping", entityId: created.id, changes: { externalObjectType: created.externalObjectType, internalEntityType: created.internalEntityType } });
        return { mapping: created, conflict: null };
      }
      if (existing.internalEntityType === input.internalEntityType && existing.internalEntityId === input.internalEntityId) {
        const updated = await tx.externalObjectMapping.update({ where: { id: existing.id }, data: { lastRecognizedAt: options.now(), externalVersion: input.externalVersion ?? existing.externalVersion, externalHash: input.externalHash ?? existing.externalHash, version: { increment: 1 }, updatedByActorId: context.actorId } });
        return { mapping: updated, conflict: null };
      }
      const conflict = await tx.externalMappingConflict.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId_reasonCode: { workspaceId: context.workspaceId, connectionId: input.connectionId, externalObjectType: input.externalObjectType, externalId: input.externalId, reasonCode: "HUMAN_MAPPING_PRECEDENCE" } }, create: { workspaceId: context.workspaceId, connectionId: input.connectionId, externalObjectType: input.externalObjectType, externalId: input.externalId, proposedInternalType: input.internalEntityType, proposedInternalId: input.internalEntityId, reasonCode: "HUMAN_MAPPING_PRECEDENCE", evidence: json({ currentType: existing.internalEntityType, currentId: existing.internalEntityId }) }, update: {} });
      await tx.externalObjectMapping.update({ where: { id: existing.id }, data: { status: "CONFLICT", updatedByActorId: context.actorId } });
      await audit(tx, context, { action: "integration.mapping.conflict_opened", entityType: "ExternalMappingConflict", entityId: conflict.id, changes: { reasonCode: conflict.reasonCode } });
      return { mapping: existing, conflict };
    });
  }

  async function resolveMappingConflict(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MAPPINGS_MANAGE);
    const input = resolveMappingConflictSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const conflict = await tx.externalMappingConflict.findFirst({ where: { id: input.conflictId, workspaceId: context.workspaceId, status: "OPEN" } });
      if (!conflict) fail("Conflito não encontrado neste workspace.", "MAPPING_CONFLICT_NOT_FOUND", 404);
      const mapping = await tx.externalObjectMapping.findUnique({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: context.workspaceId, connectionId: conflict.connectionId, externalObjectType: conflict.externalObjectType, externalId: conflict.externalId } } });
      if (mapping && input.resolution === "CONFIRMED" && conflict.proposedInternalType && conflict.proposedInternalId) await tx.externalObjectMapping.update({ where: { id: mapping.id }, data: { internalEntityType: conflict.proposedInternalType, internalEntityId: conflict.proposedInternalId, status: "ACTIVE", version: { increment: 1 }, updatedByActorId: context.actorId } });
      else if (mapping) await tx.externalObjectMapping.update({ where: { id: mapping.id }, data: { status: "ACTIVE", updatedByActorId: context.actorId } });
      const resolved = await tx.externalMappingConflict.update({ where: { id: conflict.id }, data: { status: input.resolution, resolvedByActorId: context.actorId, resolutionReason: input.reason, resolvedAt: options.now() } });
      await audit(tx, context, { action: "integration.mapping.conflict_resolved", entityType: "ExternalMappingConflict", entityId: resolved.id, reason: input.reason, changes: { resolution: input.resolution } });
      return resolved;
    });
  }

  async function createFieldMappingVersion(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MAPPINGS_MANAGE);
    const input = fieldMappingVersionSchema.parse(raw);
    await findConnection(context, input.connectionId);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-fields:${context.workspaceId}:${input.connectionId}:${input.objectType}`}, 0))`;
      const previous = await tx.integrationFieldMappingVersion.findFirst({ where: { workspaceId: context.workspaceId, connectionId: input.connectionId, objectType: input.objectType }, orderBy: { version: "desc" } });
      const version = (previous?.version ?? 0) + 1;
      const mapping = json(input.mapping); const precedence = json(input.precedence);
      const created = await tx.integrationFieldMappingVersion.create({ data: { workspaceId: context.workspaceId, connectionId: input.connectionId, objectType: input.objectType, version, schemaVersion: input.schemaVersion, mapping, precedence, configHash: sha256(canonicalJson({ mapping, precedence })), active: true, createdByActorId: context.actorId } });
      await audit(tx, context, { action: "integration.field_mapping.versioned", entityType: "IntegrationFieldMappingVersion", entityId: created.id, changes: { objectType: input.objectType, version, precedence: "HUMAN_WINS" } });
      return created;
    });
  }

  async function replay(context: AuthenticatedContext, input: Readonly<{ connectionId: string; targetKind: "INBOX" | "OUTBOX"; targetId: string; reason: string }>) {
    await authorize(context, PermissionKeys.INTEGRATIONS_REPLAY);
    await findConnection(context, input.connectionId);
    return options.database.$transaction(async (tx) => {
      if (input.targetKind === "INBOX") {
        const item = await tx.webhookInbox.findFirst({ where: { id: input.targetId, workspaceId: context.workspaceId, connectionId: input.connectionId } });
        if (!item) fail("Item da inbox não encontrado.", "INTEGRATION_ITEM_NOT_FOUND", 404);
        if (item.errorClass === "PRIVACY_BLOCKED") fail("Replay bloqueado pela decisão de privacidade.", "PRIVACY_REPLAY_BLOCKED");
        if (item.status === "PROCESSED") return { id: item.id, idempotentReplay: true, status: item.status };
        const updated = await tx.webhookInbox.update({ where: { id: item.id }, data: { status: "RETRY_PENDING", nextRetryAt: options.now(), errorClass: null, errorCode: null, errorMessage: null } });
        await audit(tx, context, { action: "integration.inbox.replay_requested", entityType: "WebhookInbox", entityId: item.id, reason: input.reason });
        return { id: updated.id, idempotentReplay: false, status: updated.status };
      }
      const item = await tx.outboxEvent.findFirst({ where: { id: input.targetId, workspaceId: context.workspaceId, connectionId: input.connectionId } });
      if (!item) fail("Item da outbox não encontrado.", "INTEGRATION_ITEM_NOT_FOUND", 404);
      if (item.errorClass === "PRIVACY_BLOCKED") fail("Replay bloqueado pela decisão de privacidade.", "PRIVACY_REPLAY_BLOCKED");
      if (item.status === "DELIVERED_LOCAL") return { id: item.id, idempotentReplay: true, status: item.status };
      const updated = await tx.outboxEvent.update({ where: { id: item.id }, data: { status: "RETRY_PENDING", availableAt: options.now(), nextRetryAt: options.now(), errorClass: null, errorCode: null, errorMessage: null } });
      await audit(tx, context, { action: "integration.outbox.replay_requested", entityType: "OutboxEvent", entityId: item.id, reason: input.reason });
      return { id: updated.id, idempotentReplay: false, status: updated.status };
    });
  }

  return Object.freeze({ list, detail, create, update, linkSecretReference, testLocal, setPaused, runSync, replay, recognizeMapping, resolveMappingConflict, createFieldMappingVersion, assertCanExecute });
}

let service: ReturnType<typeof createIntegrationPlatformService> | undefined;

export function getIntegrationPlatformService() {
  service ??= createIntegrationPlatformService({ database: getDatabaseClient(), adapters: integrationAdapterRegistry, now: () => new Date() });
  return service;
}
