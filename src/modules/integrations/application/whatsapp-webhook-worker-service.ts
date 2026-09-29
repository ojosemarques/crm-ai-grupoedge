import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { normalizeChannelAddress, shouldProjectMessageStatus } from "@/modules/communications/domain/omnichannel-contracts";
import {
  WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS,
  WHATSAPP_PROVIDER_KEY,
  deserializeWhatsAppEvent,
} from "@/modules/integrations/domain/whatsapp-contracts";
import { calculateRetryDelaySeconds, safeError } from "@/modules/integrations/domain/integration-policy";
import { cancelPendingOutboundForContactInTransaction } from "@/modules/privacy/application/privacy-service";
import { getDatabaseClient } from "@/shared/core/database/client";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number }>;
type JobPayload = Readonly<{ inboxId: string; profileId: string; provider: string }>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jobPayload(value: Prisma.JsonValue): JobPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WHATSAPP_JOB_PAYLOAD_INVALID");
  const inboxId = value.inboxId;
  const profileId = value.profileId;
  const provider = value.provider;
  if (typeof inboxId !== "string" || typeof profileId !== "string" || provider !== WHATSAPP_PROVIDER_KEY) throw new Error("WHATSAPP_JOB_PAYLOAD_INVALID");
  return { inboxId, profileId, provider };
}

async function foundation(tx: Tx, workspaceId: string) {
  const [actor, queue] = await Promise.all([
    tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.queue.findFirst({ where: { workspaceId, isGeneral: true, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  if (!actor) throw new Error("WHATSAPP_SYSTEM_ACTOR_MISSING");
  if (!queue) throw new Error("WHATSAPP_GENERAL_QUEUE_MISSING");
  return { actor, queue };
}

export function createWhatsAppWebhookWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" = 'WEBHOOK'
          AND "payload"->>'provider' = ${WHATSAPP_PROVIDER_KEY}
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      const selected = rows[0];
      if (!selected) return null;
      const job = await tx.job.update({
        where: { id: selected.id },
        data: {
          status: "RUNNING",
          lockedAt: now,
          lockedBy: workerId,
          lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000),
          attempts: { increment: 1 },
          lastAttemptAt: now,
        },
      });
      const payload = jobPayload(job.payload);
      await tx.webhookInbox.updateMany({
        where: { id: payload.inboxId, workspaceId: job.workspaceId, status: { in: ["VERIFIED", "RETRY_PENDING", "PROCESSING"] } },
        data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId, lockExpiresAt: job.lockExpiresAt, attempts: { increment: 1 } },
      });
      return job;
    }, { isolationLevel: "ReadCommitted" });
  }

  async function complete(tx: Tx, input: Readonly<{ jobId: string; inboxId: string; workspaceId: string; workerId: string; actorId: string; messageId: string | null; result: Record<string, unknown> }>) {
    const now = options.now();
    await tx.webhookInbox.update({ where: { id: input.inboxId }, data: { status: "PROCESSED", processedAt: now, messageId: input.messageId, lockedAt: null, lockedBy: null, lockExpiresAt: null, nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null } });
    const changed = await tx.job.updateMany({ where: { id: input.jobId, workspaceId: input.workspaceId, status: "RUNNING", lockedBy: input.workerId }, data: { status: "SUCCEEDED", result: json(input.result), finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, lastError: null, errorCode: null } });
    if (changed.count !== 1) throw new Error("WHATSAPP_JOB_LOCK_LOST");
    const job = await tx.job.findUniqueOrThrow({ where: { id: input.jobId }, select: { attempts: true } });
    await tx.integrationDeliveryAttempt.create({ data: { workspaceId: input.workspaceId, kind: "INBOX", inboxId: input.inboxId, attemptNumber: job.attempts, status: "SUCCEEDED", startedAt: now, finishedAt: now, resultMetadata: json(input.result) } });
    await tx.auditLog.create({ data: { workspaceId: input.workspaceId, actorId: input.actorId, action: "integration.whatsapp.webhook_processed", entityType: "WebhookInbox", entityId: input.inboxId, origin: "SYSTEM", changes: json({ ...input.result, rawPayloadLogged: false, externalEgress: false }) } });
  }

  async function processInbound(tx: Tx, item: NonNullable<Awaited<ReturnType<PrismaClient["webhookInbox"]["findUnique"]>>>, profileId: string, workerId: string, jobId: string) {
    const event = deserializeWhatsAppEvent(item.payload);
    if (event.kind !== "MESSAGE") throw new Error("WHATSAPP_EVENT_KIND_INVALID");
    const normalized = normalizeChannelAddress("WHATSAPP", event.from);
    if (!normalized.success) throw new Error("WHATSAPP_ADDRESS_INVALID");
    const profile = await tx.whatsAppConnectionProfile.findFirstOrThrow({ where: { id: profileId, workspaceId: item.workspaceId, connectionId: item.connectionId } });
    const base = await foundation(tx, item.workspaceId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-process:${item.workspaceId}:${normalized.hash}`}, 0))`;
    const existingMessage = await tx.message.findFirst({ where: { workspaceId: item.workspaceId, providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: event.eventId } });
    if (existingMessage) {
      await complete(tx, { jobId, inboxId: item.id, workspaceId: item.workspaceId, workerId, actorId: base.actor.id, messageId: existingMessage.id, result: { idempotent: true, messageId: existingMessage.id, kind: event.kind } });
      return { status: "SUCCEEDED" as const, messageId: existingMessage.id, idempotent: true };
    }
    const points = await tx.contactPoint.findMany({ where: { workspaceId: item.workspaceId, normalizedValue: normalized.normalized, type: "PHONE", deletedAt: null }, take: 3, include: { contact: { include: { leads: { where: { deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 2 } } } } });
    const exact = points.length === 1 ? points[0] : null;
    const lead = exact?.contact.leads[0] ?? null;
    const ownerMemberId = lead?.ownerMemberId ?? null;
    const queueId = ownerMemberId ? null : lead?.queueId ?? base.queue.id;
    let conversation = exact ? await tx.conversation.findFirst({ where: { workspaceId: item.workspaceId, contactPointId: exact.id, channel: "WHATSAPP", status: { notIn: ["CLOSED", "ARCHIVED"] }, deletedAt: null }, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }] }) : null;
    const createdNew = !conversation;
    const latestInboundAt = !conversation?.lastCustomerInboundAt || event.occurredAt > conversation.lastCustomerInboundAt ? event.occurredAt : conversation.lastCustomerInboundAt;
    const expiresAt = new Date(latestInboundAt.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS * 1_000);
    conversation ??= await tx.conversation.create({ data: { workspaceId: item.workspaceId, contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, accountId: lead?.accountId ?? null, leadId: lead?.id ?? null, connectionId: profile.connectionId, assigneeMemberId: ownerMemberId, queueId, channel: "WHATSAPP", status: "PENDING_INTERNAL", priority: lead?.priority ?? "MEDIUM", externalThreadId: `${WHATSAPP_PROVIDER_KEY}:${normalized.hash}`, firstInboundAt: event.occurredAt, lastCustomerInboundAt: event.occurredAt, serviceWindowExpiresAt: expiresAt, waitingSince: event.occurredAt, openedAt: event.occurredAt, createdByActorId: base.actor.id, updatedByActorId: base.actor.id } });
    if (!conversation.assigneeMemberId && !conversation.queueId) conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { assigneeMemberId: ownerMemberId, queueId, updatedByActorId: base.actor.id, revision: { increment: 1 } } });
    let participant = await tx.conversationParticipant.findFirst({ where: { workspaceId: item.workspaceId, conversationId: conversation.id, identifierKey: normalized.hash, activeUntil: null } });
    participant ??= await tx.conversationParticipant.create({ data: { workspaceId: item.workspaceId, conversationId: conversation.id, role: exact ? "CONTACT" : "UNKNOWN_EXTERNAL", contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, identifierKey: normalized.hash, externalAddressMasked: normalized.masked } });
    const replyTo = event.replyToExternalMessageId ? await tx.message.findFirst({ where: { workspaceId: item.workspaceId, providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: event.replyToExternalMessageId } }) : null;
    const message = await tx.message.create({ data: { workspaceId: item.workspaceId, conversationId: conversation.id, senderActorId: base.actor.id, senderParticipantId: participant.id, replyToMessageId: replyTo?.id ?? null, direction: "INBOUND", type: event.messageType, status: "RECEIVED", body: event.body, bodyHash: sha256(event.body), providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: event.eventId, idempotencyKey: `whatsapp-provider-inbound:${event.eventId}`, clientCorrelationId: item.correlationId, isSimulated: false, occurredAt: event.occurredAt, receivedAt: item.receivedAt } });
    await tx.messageStatusEvent.create({ data: { workspaceId: item.workspaceId, messageId: message.id, status: "RECEIVED", sequence: 1, source: "PROVIDER", providerReported: true, providerKey: WHATSAPP_PROVIDER_KEY, externalEventId: event.eventId, providerOccurredAt: event.occurredAt, ingestedAt: options.now(), actorId: base.actor.id } });
    if (event.media) await tx.attachmentReference.create({ data: { workspaceId: item.workspaceId, messageId: message.id, opaqueReference: `wa-media:${item.workspaceId}:${event.media.providerMediaId}`, fileName: event.media.fileName, contentHash: event.media.contentHash ?? `provider:${event.media.providerMediaId}`, sizeBytes: 0, mimeType: event.media.providerMimeType ?? "application/octet-stream", providerKey: WHATSAPP_PROVIDER_KEY, providerMediaId: event.media.providerMediaId, providerMimeType: event.media.providerMimeType, mediaAvailability: "REFERENCE_ONLY", createdByActorId: base.actor.id } });
    const previousOwnerMemberId = conversation.assigneeMemberId;
    const previousQueueId = conversation.queueId;
    conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { connectionId: profile.connectionId, status: "PENDING_INTERNAL", unreadCount: { increment: 1 }, lastMessageAt: !conversation.lastMessageAt || event.occurredAt > conversation.lastMessageAt ? event.occurredAt : conversation.lastMessageAt, lastCustomerInboundAt: latestInboundAt, serviceWindowExpiresAt: expiresAt, waitingSince: !conversation.waitingSince || event.occurredAt > conversation.waitingSince ? event.occurredAt : conversation.waitingSince, firstInboundAt: conversation.firstInboundAt && conversation.firstInboundAt < event.occurredAt ? conversation.firstInboundAt : event.occurredAt, updatedByActorId: base.actor.id, revision: { increment: 1 } } });
    if (createdNew) await tx.conversationAssignmentHistory.create({ data: { workspaceId: item.workspaceId, conversationId: conversation.id, previousOwnerMemberId: null, previousQueueId: null, newOwnerMemberId: conversation.assigneeMemberId, newQueueId: conversation.queueId, reason: exact ? "WhatsApp vinculado à responsabilidade operacional existente." : "Identidade WhatsApp não resolvida encaminhada à Fila Geral.", actorId: base.actor.id, occurredAt: options.now() } });
    if (!lead) await tx.messageIdentityReview.create({ data: { workspaceId: item.workspaceId, conversationId: conversation.id, messageId: message.id, contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, reason: points.length > 1 ? "MULTIPLE_CONTACT_MATCHES" : exact ? "CONTACT_WITHOUT_LEAD" : "CONTACT_NOT_FOUND", normalizedAddressHash: normalized.hash, channel: "WHATSAPP", evidence: json({ exactMatches: points.length, leadCreated: false, provider: WHATSAPP_PROVIDER_KEY }), createdByActorId: base.actor.id } });
    if (event.reviewReason) await tx.whatsAppEventReview.create({ data: { workspaceId: item.workspaceId, profileId: profile.id, webhookInboxId: item.id, conversationId: conversation.id, messageId: message.id, kind: "UNKNOWN_EVENT", eventKey: event.eventId, reasonCode: event.reviewReason, evidence: json({ messageType: event.messageType }), createdByActorId: base.actor.id } });
    if (lead) {
      await tx.activity.create({ data: { workspaceId: item.workspaceId, leadId: lead.id, messageId: message.id, type: "MESSAGE_RECEIVED", direction: "INBOUND", result: "RECEIVED", subject: "Mensagem recebida no WhatsApp", description: "Fato canônico recebido pela fronteira autenticada do provider.", occurredAt: event.occurredAt, createdByActorId: base.actor.id, updatedByActorId: base.actor.id } });
      await tx.lead.updateMany({ where: { id: lead.id, workspaceId: item.workspaceId, OR: [{ lastInboundResponseAt: null }, { lastInboundResponseAt: { lt: event.occurredAt } }] }, data: { awaitingHumanResponse: true, lastInboundResponseAt: event.occurredAt, updatedByActorId: base.actor.id } });
      await tx.lead.updateMany({ where: { id: lead.id, workspaceId: item.workspaceId, lastActivityAt: { lt: event.occurredAt } }, data: { lastActivityAt: event.occurredAt, updatedByActorId: base.actor.id } });
      if (event.optOut) {
        await tx.contactPoint.update({ where: { id: exact!.id }, data: { doNotContact: true, updatedByActorId: base.actor.id } });
        await tx.lead.updateMany({ where: { workspaceId: item.workspaceId, contactId: exact!.contactId }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: event.occurredAt, updatedByActorId: base.actor.id } });
        await cancelPendingOutboundForContactInTransaction(tx, { workspaceId: item.workspaceId, contactId: exact!.contactId, contactPointId: exact!.id, actorId: base.actor.id, now: options.now(), reasonCode: "WHATSAPP_PROVIDER_OPT_OUT" });
      }
    }
    await tx.whatsAppConnectionProfile.update({ where: { id: profile.id }, data: { lastInboundAt: !profile.lastInboundAt || event.occurredAt > profile.lastInboundAt ? event.occurredAt : profile.lastInboundAt, updatedByActorId: base.actor.id } });
    await complete(tx, { jobId, inboxId: item.id, workspaceId: item.workspaceId, workerId, actorId: base.actor.id, messageId: message.id, result: { kind: event.kind, messageId: message.id, conversationId: conversation.id, identity: lead ? "EXACT" : "REVIEW_REQUIRED", optOut: event.optOut, ownerPreserved: previousOwnerMemberId === conversation.assigneeMemberId && previousQueueId === conversation.queueId } });
    return { status: "SUCCEEDED" as const, messageId: message.id, idempotent: false };
  }

  async function processStatus(tx: Tx, item: NonNullable<Awaited<ReturnType<PrismaClient["webhookInbox"]["findUnique"]>>>, profileId: string, workerId: string, jobId: string) {
    const event = deserializeWhatsAppEvent(item.payload);
    if (event.kind !== "STATUS") throw new Error("WHATSAPP_EVENT_KIND_INVALID");
    const profile = await tx.whatsAppConnectionProfile.findFirstOrThrow({ where: { id: profileId, workspaceId: item.workspaceId, connectionId: item.connectionId } });
    const base = await foundation(tx, item.workspaceId);
    let message = await tx.message.findFirst({ where: { workspaceId: item.workspaceId, providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: event.externalMessageId } });
    if (!message || !event.status) {
      await tx.whatsAppEventReview.upsert({ where: { workspaceId_profileId_eventKey_kind: { workspaceId: item.workspaceId, profileId: profile.id, eventKey: event.eventId, kind: "UNKNOWN_EVENT" } }, create: { workspaceId: item.workspaceId, profileId: profile.id, webhookInboxId: item.id, messageId: message?.id ?? null, kind: "UNKNOWN_EVENT", eventKey: event.eventId, reasonCode: message ? event.reviewReason ?? "STATUS_UNKNOWN" : "MESSAGE_NOT_FOUND", evidence: json({ externalMessageId: event.externalMessageId, providerStatus: event.providerStatus }), createdByActorId: base.actor.id }, update: {} });
      await complete(tx, { jobId, inboxId: item.id, workspaceId: item.workspaceId, workerId, actorId: base.actor.id, messageId: message?.id ?? null, result: { kind: event.kind, reviewRequired: true, reason: message ? event.reviewReason : "MESSAGE_NOT_FOUND" } });
      return { status: "SUCCEEDED" as const, messageId: message?.id ?? null, reviewRequired: true };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-status:${item.workspaceId}:${message.id}`}, 0))`;
    message = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
    const duplicate = await tx.messageStatusEvent.findFirst({ where: { workspaceId: item.workspaceId, providerKey: WHATSAPP_PROVIDER_KEY, externalEventId: event.eventId } });
    if (!duplicate) {
      const projected = shouldProjectMessageStatus(message.status, event.status);
      const sequence = (await tx.messageStatusEvent.count({ where: { workspaceId: item.workspaceId, messageId: message.id } })) + 1;
      await tx.messageStatusEvent.create({ data: { workspaceId: item.workspaceId, messageId: message.id, status: event.status, sequence, source: "PROVIDER", providerReported: true, providerKey: WHATSAPP_PROVIDER_KEY, externalEventId: event.eventId, providerOccurredAt: event.occurredAt, ingestedAt: options.now(), reasonCode: event.transient ? "PROVIDER_TRANSIENT" : null, actorId: base.actor.id } });
      if (projected) await tx.message.update({ where: { id: message.id }, data: { status: event.status, lastProviderStatusAt: event.occurredAt, ...(event.status === "SENT" ? { sentAt: event.occurredAt } : {}), ...(event.status === "DELIVERED" ? { deliveredAt: event.occurredAt } : {}), ...(event.status === "READ" ? { readAt: event.occurredAt } : {}), revision: { increment: 1 } } });
      else if (message.status !== event.status) await tx.whatsAppEventReview.upsert({ where: { workspaceId_profileId_eventKey_kind: { workspaceId: item.workspaceId, profileId: profile.id, eventKey: event.eventId, kind: "STATUS_REGRESSION" } }, create: { workspaceId: item.workspaceId, profileId: profile.id, webhookInboxId: item.id, messageId: message.id, kind: "STATUS_REGRESSION", eventKey: event.eventId, reasonCode: "STATUS_OUT_OF_ORDER", evidence: json({ current: message.status, received: event.status, providerOccurredAt: event.occurredAt.toISOString() }), createdByActorId: base.actor.id }, update: {} });
    }
    await tx.whatsAppConnectionProfile.updateMany({ where: { id: profile.id, workspaceId: item.workspaceId, OR: [{ lastStatusAt: null }, { lastStatusAt: { lt: event.occurredAt } }] }, data: { lastStatusAt: event.occurredAt, updatedByActorId: base.actor.id } });
    await complete(tx, { jobId, inboxId: item.id, workspaceId: item.workspaceId, workerId, actorId: base.actor.id, messageId: message.id, result: { kind: event.kind, messageId: message.id, providerStatus: event.providerStatus, idempotent: Boolean(duplicate) } });
    return { status: "SUCCEEDED" as const, messageId: message.id, idempotent: Boolean(duplicate) };
  }

  async function failJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, error: unknown) {
    const payload = jobPayload(job.payload);
    const permanentCodes = new Set(["WHATSAPP_JOB_PAYLOAD_INVALID", "WHATSAPP_EVENT_KIND_INVALID", "WHATSAPP_ADDRESS_INVALID"]);
    const errorCode = error instanceof Error ? error.message : "";
    const invalid = permanentCodes.has(errorCode);
    const failure = invalid ? { classification: "INVALID_PAYLOAD" as const, code: errorCode, safeMessage: "Evento WhatsApp inválido; revisão manual necessária." } : safeError(error);
    const terminal = invalid || job.attempts >= job.maxAttempts;
    const retryAfterSeconds = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: retryAfterSeconds ? new Date(now.getTime() + retryAfterSeconds * 1_000) : job.runAt, lastError: failure.safeMessage, errorCode: failure.code, finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      const inbox = await tx.webhookInbox.update({ where: { id: payload.inboxId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", nextRetryAt: retryAfterSeconds ? new Date(now.getTime() + retryAfterSeconds * 1_000) : null, errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: "INBOX", inboxId: inbox.id, attemptNumber: job.attempts, status: terminal ? "DEAD_LETTERED" : "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, retryAfterSeconds, startedAt: job.lockedAt ?? now, finishedAt: now } });
      const actor = await tx.actor.findFirst({ where: { workspaceId: job.workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" } });
      if (actor) await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: terminal ? "integration.whatsapp.webhook_dead_lettered" : "integration.whatsapp.webhook_retry_scheduled", entityType: "WebhookInbox", entityId: inbox.id, origin: "SYSTEM", changes: json({ errorClass: failure.classification, errorCode: failure.code, attempt: job.attempts, retryAfterSeconds, rawPayloadLogged: false }) } });
      return { status: terminal ? "DEAD_LETTER" as const : "RETRY_PENDING" as const, retryAfterSeconds };
    });
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    try {
      const payload = jobPayload(job.payload);
      return await options.database.$transaction(async (tx) => {
        const item = await tx.webhookInbox.findFirst({ where: { id: payload.inboxId, workspaceId: job.workspaceId } });
        if (!item || item.signatureStatus !== "VERIFIED") throw new Error("WHATSAPP_JOB_PAYLOAD_INVALID");
        if (item.status === "PROCESSED") {
          const base = await foundation(tx, item.workspaceId);
          await complete(tx, { jobId: job.id, inboxId: item.id, workspaceId: item.workspaceId, workerId, actorId: base.actor.id, messageId: item.messageId, result: { idempotent: true, alreadyProcessed: true } });
          return { status: "SUCCEEDED" as const, idempotent: true };
        }
        const parsed = deserializeWhatsAppEvent(item.payload);
        return parsed.kind === "MESSAGE" ? processInbound(tx, item, payload.profileId, workerId, job.id) : processStatus(tx, item, payload.profileId, workerId, job.id);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      return failJob(job, workerId, error);
    }
  }

  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createWhatsAppWebhookWorkerService> | undefined;
export function getWhatsAppWebhookWorkerService() {
  service ??= createWhatsAppWebhookWorkerService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
