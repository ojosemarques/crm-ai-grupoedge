import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { integrationAdapterRegistry, type IntegrationAdapterRegistry } from "@/modules/integrations/application/integration-adapter-registry";
import type { AdapterErrorClassification } from "@/modules/integrations/domain/integration-contracts";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { calculateRetryDelaySeconds, redactSensitive } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{ database: PrismaClient; adapters: IntegrationAdapterRegistry; now: () => Date }>;
type Claimed = Readonly<{ id: string }>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue;
}

export function createIntegrationOutboxWorkerService(options: Options) {
  async function claim(workerId: string): Promise<Claimed | null> {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "outbox_events"
        WHERE "connectionId" IS NOT NULL
          AND "eventType" <> 'marketing.meta_conversion.v1'
          AND ((("status" IN ('PENDING','RETRY_PENDING') AND "availableAt" <= ${now} AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${now}))
          OR ("status" = 'PROCESSING' AND "lockExpiresAt" < ${now})))
        ORDER BY "availableAt" ASC, "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      const selected = rows[0];
      if (!selected) return null;
      await tx.outboxEvent.update({ where: { id: selected.id }, data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + 30_000), attempts: { increment: 1 } } });
      return selected;
    }, { isolationLevel: "ReadCommitted" });
  }

  async function finishFailure(item: Awaited<ReturnType<PrismaClient["outboxEvent"]["findUnique"]>>, workerId: string, failure: AdapterErrorClassification) {
    if (!item) return null;
    const transient = failure.classification === "TRANSIENT" || failure.classification === "RATE_LIMIT";
    const terminal = !transient || item.attempts >= item.maxAttempts;
    const delay = calculateRetryDelaySeconds(item.attempts, 5, failure.retryAfterSeconds);
    return options.database.$transaction(async (tx) => {
      const updated = await tx.outboxEvent.updateMany({ where: { id: item.id, workspaceId: item.workspaceId, status: "PROCESSING", lockedBy: workerId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", nextRetryAt: terminal ? null : new Date(options.now().getTime() + delay * 1_000), lockedAt: null, lockedBy: null, lockExpiresAt: null, errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage } });
      if (updated.count !== 1) return null;
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: item.workspaceId, kind: "OUTBOX", outboxId: item.id, attemptNumber: item.attempts, status: terminal ? "DEAD_LETTERED" : "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, retryAfterSeconds: failure.retryAfterSeconds ?? null, startedAt: item.lockedAt ?? options.now(), finishedAt: options.now() } });
      return { id: item.id, status: terminal ? "DEAD_LETTER" as const : "RETRY_PENDING" as const, delaySeconds: terminal ? null : delay };
    });
  }

  async function processNext(workerId: string) {
    const selected = await claim(workerId);
    if (!selected) return null;
    const item = await options.database.outboxEvent.findUnique({ where: { id: selected.id }, include: { connection: { include: { configVersions: { orderBy: { version: "desc" }, take: 1 } } } } });
    if (!item?.connection || !item.connection.enabled || item.connection.environment !== "LOCAL" || item.connection.capabilityLevel !== "VALIDATED_LOCALLY") {
      return finishFailure(item, workerId, { classification: "CONFIGURATION", code: "INTEGRATION_NOT_READY", safeMessage: "Conexão local indisponível para entrega." });
    }
    const adapter = options.adapters.get(item.connection.adapterKey);
    const version = item.connection.configVersions[0];
    if (!version) return finishFailure(item, workerId, { classification: "CONFIGURATION", code: "INTEGRATION_CONFIG_NOT_FOUND", safeMessage: "Configuração versionada ausente." });
    const config = adapter.validateConfiguration(version.config);
    const leadId = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) && typeof item.payload.leadId === "string" ? item.payload.leadId : null;
    if (leadId) {
      const actor = await options.database.actor.findFirst({ where: { workspaceId: item.workspaceId, type: "SYSTEM" }, select: { id: true } });
      if (!actor) return finishFailure(item, workerId, { classification: "CONFIGURATION", code: "SYSTEM_ACTOR_MISSING", safeMessage: "Ator de sistema não configurado." });
      const decision = await options.database.$transaction((tx) => evaluatePrivacyInTransaction(tx, { workspaceId: item.workspaceId, actorId: actor.id, leadId, channel: "OTHER", intendedAction: "INTEGRATION_OUTBOX_DELIVERY" }));
      if (decision.outcome !== "ALLOW") return finishFailure(item, workerId, { classification: "PRIVACY_BLOCKED", code: `PRIVACY_${decision.outcome}`, safeMessage: "Entrega bloqueada pela decisão de privacidade." });
    }
    try {
      const result = await adapter.push(config, item.payload as Readonly<Record<string, unknown>>);
      const committed = await options.database.$transaction(async (tx) => {
        const changed = await tx.outboxEvent.updateMany({ where: { id: item.id, workspaceId: item.workspaceId, status: "PROCESSING", lockedBy: workerId }, data: { status: "DELIVERED_LOCAL", deliveredLocallyAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null } });
        if (changed.count !== 1) return null;
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: item.workspaceId, kind: "OUTBOX", outboxId: item.id, attemptNumber: item.attempts, status: "SUCCEEDED", startedAt: item.lockedAt ?? options.now(), finishedAt: options.now(), resultMetadata: json({ capabilityLevel: result.capabilityLevel, facts: result.facts, externalEgress: false }) } });
        return { id: item.id, status: "DELIVERED_LOCAL" as const };
      });
      if (config.fault === "AFTER_COMMIT") throw new Error("LOCAL_AFTER_COMMIT_SIMULATION");
      return committed;
    } catch (error) {
      if (error instanceof Error && error.message === "LOCAL_AFTER_COMMIT_SIMULATION") throw error;
      return finishFailure(item, workerId, adapter.classifyError(error));
    }
  }
  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createIntegrationOutboxWorkerService> | undefined;
export function getIntegrationOutboxWorkerService() {
  service ??= createIntegrationOutboxWorkerService({ database: getDatabaseClient(), adapters: integrationAdapterRegistry, now: () => new Date() });
  return service;
}
