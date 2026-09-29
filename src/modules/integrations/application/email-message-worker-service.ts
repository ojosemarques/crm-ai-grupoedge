import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { localEmailSinkTransport, type EmailTransportAdapter } from "@/modules/integrations/application/email-transport";
import { EMAIL_PROVIDER_KEY } from "@/modules/integrations/domain/email-contracts";
import { calculateRetryDelaySeconds, safeError } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{ database: PrismaClient; transport: EmailTransportAdapter; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number }>;
type Payload = Readonly<{ messageId: string; outboxId: string }>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function payload(value: Prisma.JsonValue): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("EMAIL_JOB_PAYLOAD_INVALID");
  if (typeof value.messageId !== "string" || typeof value.outboxId !== "string") throw new Error("EMAIL_JOB_PAYLOAD_INVALID");
  return { messageId: value.messageId, outboxId: value.outboxId };
}

export function createEmailMessageWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT j."id" FROM "jobs" j
        JOIN "messages" m ON m."workspaceId" = j."workspaceId" AND m."id" = (j."payload"->>'messageId')::uuid
        JOIN "conversations" c ON c."workspaceId" = m."workspaceId" AND c."id" = m."conversationId"
        WHERE j."type" = 'OMNICHANNEL_MESSAGE' AND c."channel" = 'EMAIL'
          AND ((j."status" = 'PENDING' AND j."runAt" <= ${now})
            OR (j."status" = 'RUNNING' AND j."lockExpiresAt" < ${now}))
        ORDER BY j."priority" DESC, j."runAt" ASC, j."createdAt" ASC
        FOR UPDATE OF j SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000), attempts: { increment: 1 }, lastAttemptAt: now } });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function cancelByPolicy(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, messageId: string, outboxId: string, actorId: string, reasonCode: string) {
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "CANCELLED", cancelledAt: now, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: reasonCode, lastError: "Entrega local cancelada pela política vigente.", updatedByActorId: actorId } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      await tx.outboxEvent.updateMany({ where: { id: outboxId, workspaceId: job.workspaceId }, data: { status: "CANCELLED", errorClass: "PRIVACY_BLOCKED", errorCode: reasonCode, errorMessage: "Entrega local cancelada pela política vigente." } });
      await tx.message.updateMany({ where: { id: messageId, workspaceId: job.workspaceId }, data: { status: "CANCELLED", revision: { increment: 1 } } });
      const sequence = (await tx.messageStatusEvent.count({ where: { workspaceId: job.workspaceId, messageId } })) + 1;
      await tx.messageStatusEvent.create({ data: { workspaceId: job.workspaceId, messageId, status: "CANCELLED", sequence, source: "INTERNAL", reasonCode, actorId, ingestedAt: now } });
      await tx.messageDeliveryAttempt.updateMany({ where: { workspaceId: job.workspaceId, messageId, jobId: job.id, finishedAt: null }, data: { status: "CANCELLED", finishedAt: now, retryable: false, errorCode: reasonCode, errorClassification: "PRIVACY_BLOCKED" } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId, action: "integration.email.delivery_cancelled_by_policy", entityType: "Message", entityId: messageId, origin: "SYSTEM", changes: json({ reasonCode, externalEgress: false }) } });
      return { status: "CANCELLED" as const, reasonCode };
    });
  }

  async function failJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, error: unknown) {
    const knownCode = error instanceof Error ? error.message : "";
    const knownPermanent = new Set(["EMAIL_JOB_PAYLOAD_INVALID", "EMAIL_SYSTEM_ACTOR_MISSING", "EMAIL_EXTERNAL_EGRESS_FORBIDDEN"]);
    const failure = knownPermanent.has(knownCode)
      ? { classification: "CONFIGURATION" as const, code: knownCode, safeMessage: "Configuração local de e-mail inválida; nenhum envio foi realizado." }
      : safeError(error);
    const terminal = job.attempts >= job.maxAttempts || failure.classification === "PERMANENT" || failure.classification === "CONFIGURATION";
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000), finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: failure.code, lastError: failure.safeMessage } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      const parsed = payload(job.payload);
      await tx.outboxEvent.updateMany({ where: { id: parsed.outboxId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.messageDeliveryAttempt.updateMany({ where: { workspaceId: job.workspaceId, messageId: parsed.messageId, jobId: job.id, finishedAt: null }, data: { status: terminal ? "FAILED_PERMANENT" : "RETRY_PENDING", finishedAt: now, retryable: !terminal, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorCode: failure.code, errorClassification: failure.classification } });
      return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const, delaySeconds: delay };
    });
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    try {
      const parsed = payload(job.payload);
      const row = await options.database.message.findFirst({ where: { id: parsed.messageId, workspaceId: job.workspaceId }, include: { conversation: { include: { connection: { include: { emailProfile: true } }, contactPoint: true } }, emailProfile: { include: { recipients: true } }, outboxEvents: { where: { id: parsed.outboxId }, take: 1 } } });
      if (!row || row.conversation.channel !== "EMAIL" || !row.emailProfile || !row.conversation.connection?.emailProfile || !row.outboxEvents[0]) throw new Error("EMAIL_JOB_PAYLOAD_INVALID");
      await options.database.messageDeliveryAttempt.upsert({
        where: { workspaceId_messageId_attemptNumber: { workspaceId: job.workspaceId, messageId: row.id, attemptNumber: job.attempts } },
        create: { workspaceId: job.workspaceId, messageId: row.id, outboxId: parsed.outboxId, jobId: job.id, attemptNumber: job.attempts, status: "RUNNING", startedAt: options.now() },
        update: {},
      });
      const actor = await options.database.actor.findFirst({ where: { workspaceId: job.workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!actor) throw new Error("EMAIL_SYSTEM_ACTOR_MISSING");
      const profile = row.conversation.connection.emailProfile;
      const latestSuppression = row.conversation.contactPoint ? await options.database.emailSuppression.findFirst({ where: { workspaceId: job.workspaceId, normalizedEmail: row.conversation.contactPoint.normalizedValue, purposeKey: "legacy-commercial-contact" }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] }) : null;
      if (!row.conversation.connection.enabled || profile.operatingMode !== "LOCAL_SINK") return cancelByPolicy(job, workerId, row.id, parsed.outboxId, actor.id, "EMAIL_LOCAL_MODE_INACTIVE");
      if (row.conversation.contactPoint?.doNotContact || latestSuppression?.action === "APPLIED") return cancelByPolicy(job, workerId, row.id, parsed.outboxId, actor.id, "EMAIL_SUPPRESSED");
      const recipients = row.emailProfile.recipients;
      const result = await options.transport.send({ from: profile.senderAddressNormalized, replyTo: profile.replyTo, to: recipients.filter((item) => item.type === "TO").map((item) => item.normalizedAddress), cc: recipients.filter((item) => item.type === "CC").map((item) => item.normalizedAddress), bcc: recipients.filter((item) => item.type === "BCC").map((item) => item.normalizedAddress), subject: row.subject ?? "", text: row.body ?? "", messageId: row.emailProfile.messageIdHeader, inReplyTo: row.emailProfile.inReplyToHeader, references: row.emailProfile.referencesHeaders, idempotencyKey: row.idempotencyKey ?? row.id });
      if (options.transport.externalEgress || !result.simulated) throw new Error("EMAIL_EXTERNAL_EGRESS_FORBIDDEN");
      const now = options.now();
      return options.database.$transaction(async (tx) => {
        const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: json({ providerMessageId: result.providerMessageId, simulated: true, externalEgress: false }), finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null, updatedByActorId: actor.id } });
        if (changed.count !== 1) return { status: "LOST_LOCK" as const };
        await tx.outboxEvent.update({ where: { id: parsed.outboxId }, data: { status: "DELIVERED_LOCAL", deliveredLocallyAt: now, attempts: { increment: 1 }, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorClass: null, errorCode: null, errorMessage: null } });
        await tx.emailMessageProfile.update({ where: { id: row.emailProfile!.id }, data: { providerMessageId: result.providerMessageId } });
        const sequence = (await tx.messageStatusEvent.count({ where: { workspaceId: job.workspaceId, messageId: row.id } })) + 1;
        await tx.messageStatusEvent.create({ data: { workspaceId: job.workspaceId, messageId: row.id, status: "PROVIDER_ACCEPTED", sequence, source: "LOCAL_SIMULATOR", providerKey: EMAIL_PROVIDER_KEY, externalEventId: `sink:${result.requestId}`, providerOccurredAt: now, providerReported: false, reasonCode: "LOCAL_SINK_ACCEPTED", actorId: actor.id, ingestedAt: now } });
        await tx.message.update({ where: { id: row.id }, data: { status: "PROVIDER_ACCEPTED", providerAcceptedAt: now, lastProviderStatusAt: now, revision: { increment: 1 } } });
        await tx.messageDeliveryAttempt.updateMany({ where: { workspaceId: job.workspaceId, messageId: row.id, jobId: job.id, finishedAt: null }, data: { status: "ACCEPTED_INTERNAL", finishedAt: now, retryable: false, providerRequestId: result.requestId } });
        await tx.emailConnectionProfile.update({ where: { id: profile.id }, data: { lastSuccessAt: now, updatedByActorId: actor.id } });
        await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "integration.email.local_sink_accepted", entityType: "Message", entityId: row.id, origin: "SYSTEM", changes: json({ providerMessageId: result.providerMessageId, simulated: true, externalEgress: false }) } });
        return { status: "SUCCEEDED" as const, messageId: row.id, simulated: true, externalEgress: false };
      });
    } catch (error) {
      return failJob(job, workerId, error);
    }
  }

  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createEmailMessageWorkerService> | undefined;
export function getEmailMessageWorkerService() {
  service ??= createEmailMessageWorkerService({ database: getDatabaseClient(), transport: localEmailSinkTransport, now: () => new Date() });
  return service;
}
