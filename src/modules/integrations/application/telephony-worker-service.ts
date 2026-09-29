import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { applyTelephonyEventInTransaction } from "@/modules/integrations/application/telephony-service";
import {
  LocalTelephonySimulatorAdapter,
  TelephonyTransportError,
  type TelephonyAdapter,
} from "@/modules/integrations/application/telephony-transport";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";
import { telephonyScenarios, type TelephonyScenario } from "@/modules/integrations/domain/telephony-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{ database: PrismaClient; adapter: TelephonyAdapter; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number }>;
type Payload = Readonly<{ callId: string; outboxId: string; scenario: TelephonyScenario; externalEgress: false }>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function parsePayload(value: Prisma.JsonValue): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TelephonyTransportError("TELEPHONY_JOB_PAYLOAD_INVALID", false);
  if (typeof value.callId !== "string" || typeof value.outboxId !== "string" || value.externalEgress !== false || !telephonyScenarios.includes(value.scenario as TelephonyScenario)) throw new TelephonyTransportError("TELEPHONY_JOB_PAYLOAD_INVALID", false);
  return { callId: value.callId, outboxId: value.outboxId, scenario: value.scenario as TelephonyScenario, externalEgress: false };
}

export function createTelephonyWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" = 'TELEPHONY_CALL'
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000), attempts: { increment: 1 }, lastAttemptAt: now } });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function failJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, parsed: Payload, error: unknown) {
    const retryable = error instanceof TelephonyTransportError ? error.retryable : false;
    const code = error instanceof TelephonyTransportError ? error.code : "TELEPHONY_LOCAL_INTERNAL_FAILURE";
    const terminal = !retryable || job.attempts >= job.maxAttempts;
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const actor = await tx.actor.findFirst({ where: { workspaceId: job.workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!actor) throw new TelephonyTransportError("TELEPHONY_SYSTEM_ACTOR_MISSING", false);
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000), finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: code, lastError: terminal ? "Cenário local encerrado em falha; nenhum egress ocorreu." : "Cenário local elegível para nova tentativa." } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      await tx.outboxEvent.updateMany({ where: { id: parsed.outboxId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: { increment: 1 }, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do simulador local.", lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.phoneCallAttempt.updateMany({ where: { workspaceId: job.workspaceId, callId: parsed.callId, attemptNumber: job.attempts }, data: { status: terminal ? "FAILED_PERMANENT" : "RETRY_PENDING", finishedAt: now, retryable: !terminal, errorCode: code, errorClassification: retryable ? "TRANSIENT" : "PERMANENT", nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000) } });
      if (terminal) {
        const call = await tx.phoneCall.findFirst({ where: { id: parsed.callId, workspaceId: job.workspaceId } });
        if (call && !["COMPLETED", "BUSY", "NO_ANSWER", "CANCELLED", "FAILED", "VOICEMAIL"].includes(call.status)) {
          await applyTelephonyEventInTransaction(tx, { workspaceId: job.workspaceId, actorId: actor.id, source: "INTERNAL", event: { eventId: `failure:${job.id}:${job.attempts}`, callId: parsed.callId, status: "FAILED", occurredAt: now, sequence: call.statusSequence + 1, reasonCode: code, metadata: { scenario: parsed.scenario, attempt: job.attempts, simulated: true } } });
        }
      }
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: terminal ? "telephony.call.dead_lettered" : "telephony.call.retry_scheduled", entityType: "PhoneCall", entityId: parsed.callId, origin: "SYSTEM", changes: json({ code, attempt: job.attempts, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000).toISOString(), externalEgress: false }) } });
      return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const, delaySeconds: delay, code };
    });
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    let parsed: Payload;
    try { parsed = parsePayload(job.payload); }
    catch (error) {
      const fallback = { callId: "00000000-0000-0000-0000-000000000000", outboxId: "00000000-0000-0000-0000-000000000000", scenario: "PERMANENT_FAILURE" as const, externalEgress: false as const };
      return failJob(job, workerId, fallback, error);
    }
    try {
      const call = await options.database.phoneCall.findFirst({ where: { id: parsed.callId, workspaceId: job.workspaceId }, include: { profile: { include: { connection: true } } } });
      if (!call) throw new TelephonyTransportError("TELEPHONY_CALL_NOT_FOUND", false);
      if (call.profile.operatingMode !== "LOCAL_SIMULATOR" || !call.profile.connection.enabled) throw new TelephonyTransportError("TELEPHONY_LOCAL_SIMULATOR_INACTIVE", false);
      if (options.adapter.externalEgress) throw new TelephonyTransportError("TELEPHONY_EXTERNAL_EGRESS_FORBIDDEN", false);
      await options.database.phoneCallAttempt.upsert({
        where: { workspaceId_callId_attemptNumber: { workspaceId: job.workspaceId, callId: call.id, attemptNumber: job.attempts } },
        create: { workspaceId: job.workspaceId, callId: call.id, outboxId: parsed.outboxId, jobId: job.id, attemptNumber: job.attempts, status: "RUNNING", scenario: parsed.scenario, startedAt: options.now() },
        update: {},
      });
      const result = await options.adapter.start({ callId: call.id, idempotencyKey: call.idempotencyKey, scenario: parsed.scenario, attempt: job.attempts, startedAt: options.now() });
      if (result.externalEgress || !result.simulated || options.adapter.getRecordingReference() !== null) throw new TelephonyTransportError("TELEPHONY_EXTERNAL_EGRESS_FORBIDDEN", false);
      const now = options.now();
      return options.database.$transaction(async (tx) => {
        const actor = await tx.actor.findFirst({ where: { workspaceId: job.workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (!actor) throw new TelephonyTransportError("TELEPHONY_SYSTEM_ACTOR_MISSING", false);
        const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: json({ providerCallId: result.providerCallId, simulated: true, externalEgress: false }), finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null, updatedByActorId: actor.id } });
        if (changed.count !== 1) return { status: "LOST_LOCK" as const };
        for (const item of result.events) {
          await applyTelephonyEventInTransaction(tx, { workspaceId: job.workspaceId, actorId: actor.id, source: "LOCAL_SIMULATOR", event: { ...item, callId: call.id } });
        }
        await tx.outboxEvent.update({ where: { id: parsed.outboxId }, data: { status: "DELIVERED_LOCAL", attempts: { increment: 1 }, deliveredLocallyAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorClass: null, errorCode: null, errorMessage: null } });
        await tx.phoneCallAttempt.update({ where: { workspaceId_callId_attemptNumber: { workspaceId: job.workspaceId, callId: call.id, attemptNumber: job.attempts } }, data: { status: "SUCCEEDED", finishedAt: now, retryable: false, requestId: result.requestId } });
        await tx.phoneCall.update({ where: { id: call.id }, data: { externalCallId: result.providerCallId, updatedByActorId: actor.id } });
        await tx.telephonyConnectionProfile.update({ where: { id: call.profileId }, data: { lastSuccessAt: now, updatedByActorId: actor.id } });
        await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "telephony.call.simulated_local", entityType: "PhoneCall", entityId: call.id, origin: "SYSTEM", changes: json({ scenario: parsed.scenario, events: result.events.length, recording: false, transcription: false, externalEgress: false }) } });
        return { status: "SUCCEEDED" as const, callId: call.id, scenario: parsed.scenario, externalEgress: false };
      });
    } catch (error) {
      return failJob(job, workerId, parsed, error);
    }
  }

  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createTelephonyWorkerService> | undefined;
export function getTelephonyWorkerService() {
  service ??= createTelephonyWorkerService({ database: getDatabaseClient(), adapter: new LocalTelephonySimulatorAdapter(), now: () => new Date() });
  return service;
}
