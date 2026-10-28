import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { metaNativeConfigurationSchema } from "../domain/meta-native-contracts";
import { privacyEvidence } from "@/modules/conversion-feedback/application/conversion-feedback-service";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { sha256 } from "@/modules/integrations/domain/integration-policy";
import { META_ADS_DEFAULT_API_VERSION } from "@/modules/integrations/domain/meta-ads-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { assertMetaNativeTarget } from "./meta-native-target";

const EVENT = "meta.native.lifecycle";
const payloadSchema = z.object({ factId: z.string().uuid(), leadId: z.string().uuid(), metaLeadId: z.string().regex(/^\d{3,40}$/), pageId: z.string().regex(/^\d{3,40}$/), eventName: z.enum(["Schedule", "Purchase"]), eventId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Options = { database: PrismaClient; secrets: SecretResolver; fetcher: typeof fetch; now: () => Date };

export function createMetaNativeFeedbackWorker(options: Options) {
  async function scan() {
    const connections = await options.database.integrationConnection.findMany({ where: { providerKey: "META_LEAD_ADS", enabled: true, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] } }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 } } });
    for (const connection of connections) {
      const config = connection.configVersions[0]?.config as Record<string, unknown> | undefined;
      const native = metaNativeConfigurationSchema.safeParse(config?.metaNative);
      if (!native.success || !native.data.datasetId) continue;
      await options.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-native-feedback:${connection.id}`}, 0))`;
        // Buscar os ainda não enfileirados evita perder commits fora de ordem ou vínculos reconhecidos depois.
        const candidates = await tx.$queryRaw<{ id: string }[]>`SELECT f.id FROM commercial_metric_facts f
          WHERE f."workspaceId"=${connection.workspaceId}::uuid AND f."eventType" IN ('MEETING_SCHEDULED','SALE_WON')
            AND f."recordedAt">=${connection.createdAt} AND f."occurredAt">=${new Date(options.now().getTime() - 7 * 86_400_000)}
            AND f."reversedAt" IS NULL AND f."correctionOfFactId" IS NULL
            AND COALESCE(f."safeMetadata"->>'provenance','')<>'backfill'
            AND (f."eventType"<>'MEETING_SCHEDULED' OR (f."meetingId" IS NOT NULL AND COALESCE(f."safeMetadata"->>'bookingBasis','')<>'STAGE_TRANSITION'))
            AND EXISTS (SELECT 1 FROM external_object_mappings m WHERE m."workspaceId"=f."workspaceId" AND m."connectionId"=${connection.id}::uuid AND m."externalObjectType"='lead' AND m."internalEntityType"='LEAD' AND m."internalEntityId"=f."leadId"::text AND m.status='ACTIVE')
            AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o."workspaceId"=f."workspaceId" AND o."connectionId"=${connection.id}::uuid AND o."eventType"=${EVENT} AND o."aggregateId"=f.id::text)
          ORDER BY f."recordedAt", f.id LIMIT 50`;
        const facts = await tx.commercialMetricFact.findMany({ where: { workspaceId: connection.workspaceId, id: { in: candidates.map((row) => row.id) } }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
        const actor = await tx.actor.findFirst({ where: { workspaceId: connection.workspaceId, type: "SYSTEM" }, select: { id: true } });
        if (!actor || !facts.length) return;
        for (const fact of facts) {
          const metadata = fact.safeMetadata as Record<string, unknown> | null;
          if (!fact.leadId || fact.reversedAt || fact.correctionOfFactId || metadata?.provenance === "backfill" || (fact.eventType === "MEETING_SCHEDULED" && (!fact.meetingId || metadata?.bookingBasis === "STAGE_TRANSITION"))) continue;
          const mapping = await tx.externalObjectMapping.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, externalObjectType: "lead", internalEntityType: "LEAD", internalEntityId: fact.leadId, status: "ACTIVE" }, orderBy: { externalVersion: "desc" } });
          if (!mapping || !/^\d{3,40}$/.test(mapping.externalId) || !mapping.externalVersion || new Date(mapping.externalVersion) > fact.occurredAt) continue;
          const key = `${EVENT}:${connection.id}:${fact.id}`;
          if (await tx.outboxEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: connection.workspaceId, idempotencyKey: key } } })) continue;
          await createOutboxEventInTransaction(tx, { workspaceId: connection.workspaceId, connectionId: connection.id, actorId: actor.id, eventType: EVENT, aggregateType: "CommercialMetricFact", aggregateId: fact.id, correlationId: randomUUID(), idempotencyKey: key, payload: { factId: fact.id, leadId: fact.leadId, metaLeadId: mapping.externalId, eventName: fact.eventType === "MEETING_SCHEDULED" ? "Schedule" : "Purchase", eventId: sha256(key), pageId: native.data.pageId } });
        }
      });
    }
  }
  async function processNext(workerId: string) {
    await scan();
    const item = await options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM outbox_events WHERE "eventType"=${EVENT} AND (((status IN ('PENDING','RETRY_PENDING')) AND "availableAt"<=${now} AND ("nextRetryAt" IS NULL OR "nextRetryAt"<=${now})) OR (status='PROCESSING' AND "lockExpiresAt"<${now})) ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      return rows[0] ? tx.outboxEvent.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", attempts: { increment: 1 }, lockedBy: workerId, lockedAt: now, lockExpiresAt: new Date(now.getTime() + 90_000) } }) : null;
    });
    if (!item) return { status: "IDLE" as const };
    const finish = async (success: boolean, code: string | null, retry = false) => {
      const status = success ? "DELIVERED_EXTERNAL" : retry && item.attempts < item.maxAttempts ? "RETRY_PENDING" : "DEAD_LETTER";
      await options.database.$transaction(async (tx) => {
        const updated = await tx.outboxEvent.updateMany({ where: { id: item.id, lockedBy: workerId, status: "PROCESSING" }, data: { status, errorCode: code, errorMessage: code ? "Sinal nativo não entregue. Verifique conexão, privacidade e recibo Meta." : null, errorClass: code === "META_NATIVE_PRIVACY_BLOCKED" ? "PRIVACY_BLOCKED" : code ? retry ? "TRANSIENT" : "CONFIGURATION" : null, nextRetryAt: status === "RETRY_PENDING" ? new Date(options.now().getTime() + Math.min(3600, 30 * 2 ** item.attempts) * 1000) : null, deliveredExternallyAt: success ? options.now() : null, lockedBy: null, lockedAt: null, lockExpiresAt: null } });
        if (updated.count) await tx.integrationDeliveryAttempt.create({ data: { workspaceId: item.workspaceId, kind: "OUTBOX", outboxId: item.id, attemptNumber: item.attempts, status: success ? "SUCCEEDED" : status === "DEAD_LETTER" ? "DEAD_LETTERED" : "FAILED", errorCode: code, startedAt: item.lockedAt!, finishedAt: options.now(), resultMetadata: { provider: "META", eventsReceived: success ? 1 : 0, rawIdentitySent: false } } });
      });
      return { status };
    };
    const connection = await options.database.integrationConnection.findFirst({ where: { id: item.connectionId!, workspaceId: item.workspaceId, providerKey: "META_LEAD_ADS", enabled: true, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] } }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 }, secrets: { where: { disabledAt: null, present: true }, orderBy: { version: "desc" } } } });
    const config = connection?.configVersions[0]?.config as Record<string, unknown> | undefined;
    const native = metaNativeConfigurationSchema.safeParse(config?.metaNative);
    if (!connection || !native.success || !native.data.datasetId) return finish(false, "META_NATIVE_CONNECTION_REVOKED");
    try { await assertMetaNativeTarget(options.secrets, item.workspaceId, native.data); }
    catch { return finish(false, "META_NATIVE_CREDENTIAL_TARGET_MISMATCH"); }
    const parsedPayload = payloadSchema.safeParse(item.payload);
    if (!parsedPayload.success) return finish(false, "META_NATIVE_PAYLOAD_INVALID");
    const payload = parsedPayload.data;
    if (payload.pageId !== native.data.pageId) return finish(false, "META_NATIVE_TARGET_MISMATCH");
    const fact = await options.database.commercialMetricFact.findFirst({ where: { id: item.aggregateId, workspaceId: item.workspaceId, leadId: payload.leadId, reversedAt: null, correctionOfFactId: null, eventType: { in: ["MEETING_SCHEDULED", "SALE_WON"] } } });
    const lead = await options.database.lead.findFirst({ where: { workspaceId: item.workspaceId, id: payload.leadId, deletedAt: null }, select: { contactId: true } });
    const mapping = await options.database.externalObjectMapping.findFirst({ where: { workspaceId: item.workspaceId, connectionId: connection.id, externalObjectType: "lead", externalId: payload.metaLeadId, internalEntityId: payload.leadId, status: "ACTIVE" } });
    if (!fact || !lead?.contactId || !mapping) return finish(false, "META_NATIVE_IDENTITY_UNAVAILABLE");
    if ((fact.eventType === "MEETING_SCHEDULED" ? "Schedule" : "Purchase") !== payload.eventName || payload.factId !== fact.id) return finish(false, "META_NATIVE_EVENT_MISMATCH");
    if (options.now().getTime() - fact.occurredAt.getTime() > 7 * 86_400_000 || fact.occurredAt > options.now()) return finish(false, "META_NATIVE_EVENT_EXPIRED");
    const allowed = await options.database.$transaction((tx) => privacyEvidence(tx, { workspaceId: item.workspaceId, actorId: item.createdByActorId, contactId: lead.contactId!, now: options.now() }));
    if (!allowed.allowed) return finish(false, "META_NATIVE_PRIVACY_BLOCKED");
    const reference = connection.secrets.find((ref) => ref.alias === "conversion-token");
    const token = reference ? await options.secrets.resolve(reference.referenceKey) : null;
    if (!token) return finish(false, "META_NATIVE_CONVERSION_TOKEN_MISSING");
    const event = { event_name: payload.eventName, event_id: payload.eventId, event_time: Math.floor(fact.occurredAt.getTime() / 1000), action_source: "system_generated", user_data: { lead_id: payload.metaLeadId }, custom_data: { event_source: "crm", lead_event_source: "PolitizAI CRM", ...(fact.eventType === "SALE_WON" ? { currency: "BRL", ...(fact.valueCents !== null ? { value: Number(fact.valueCents) / 100 } : {}) } : {}) } };
    try {
      const response = await options.fetcher(`https://graph.facebook.com/${META_ADS_DEFAULT_API_VERSION}/${native.data.datasetId}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: [event] }), signal: AbortSignal.timeout(10_000), redirect: "error" });
      const receipt = await response.json().catch(() => null) as { events_received?: number; error?: { is_transient?: boolean; code?: number } } | null;
      if (response.ok && receipt?.events_received === 1) return finish(true, null);
      return finish(false, `META_NATIVE_CAPI_${receipt?.error?.code ?? response.status}`, response.status === 429 || response.status >= 500 || receipt?.error?.is_transient === true);
    } catch { return finish(false, "META_NATIVE_CAPI_NETWORK", true); }
  }
  return Object.freeze({ processNext, scan });
}
let singleton: ReturnType<typeof createMetaNativeFeedbackWorker> | undefined;
export function getMetaNativeFeedbackWorker() { singleton ??= createMetaNativeFeedbackWorker({ database: getDatabaseClient(), secrets: environmentSecretResolver, fetcher: fetch, now: () => new Date() }); return singleton; }
