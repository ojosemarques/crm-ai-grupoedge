import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";
import {
  localPaymentSandbox,
  PaymentSandboxError,
  type PaymentSandboxAdapter,
} from "@/modules/payments/application/payment-sandbox-adapter";
import { appendPaymentEventInTransaction, createPaymentService } from "@/modules/payments/application/payment-service";
import {
  invoiceStatusAfterPayment,
  paymentWebhookEventSchema,
  signPaymentWebhook,
} from "@/modules/payments/domain/payment-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{
  database: PrismaClient;
  adapter: PaymentSandboxAdapter;
  now: () => Date;
  lockTimeoutSeconds?: number;
  backoffBaseSeconds?: number;
}>;

type AttemptPayload = Readonly<{ attemptId: string; invoiceId: string; outboxId: string | null; scenario: "SUCCESS" | "DECLINED" | "TIMEOUT" | "PERMANENT_FAILURE" | "CHARGEBACK" | "UNMATCHED"; externalEgress: false }>;
type WebhookPayload = Readonly<{ receiptId: string; forcedInvoiceId?: string; externalEgress: false }>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseObject(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentSandboxError("PAYMENT_JOB_PAYLOAD_INVALID", false);
  return value;
}

function parseAttemptPayload(value: Prisma.JsonValue): AttemptPayload {
  const payload = parseObject(value);
  const scenarios = new Set(["SUCCESS", "DECLINED", "TIMEOUT", "PERMANENT_FAILURE", "CHARGEBACK", "UNMATCHED"]);
  if (typeof payload.attemptId !== "string" || typeof payload.invoiceId !== "string" || (payload.outboxId !== null && typeof payload.outboxId !== "string") || typeof payload.scenario !== "string" || !scenarios.has(payload.scenario) || payload.externalEgress !== false) {
    throw new PaymentSandboxError("PAYMENT_JOB_PAYLOAD_INVALID", false);
  }
  return { attemptId: payload.attemptId, invoiceId: payload.invoiceId, outboxId: payload.outboxId, scenario: payload.scenario as AttemptPayload["scenario"], externalEgress: false };
}

function parseWebhookPayload(value: Prisma.JsonValue): WebhookPayload {
  const payload = parseObject(value);
  if (typeof payload.receiptId !== "string" || (payload.forcedInvoiceId !== undefined && typeof payload.forcedInvoiceId !== "string") || payload.externalEgress !== false) {
    throw new PaymentSandboxError("PAYMENT_WEBHOOK_JOB_PAYLOAD_INVALID", false);
  }
  return { receiptId: payload.receiptId, ...(typeof payload.forcedInvoiceId === "string" ? { forcedInvoiceId: payload.forcedInvoiceId } : {}), externalEgress: false };
}

async function actorFor(database: PrismaClient | Prisma.TransactionClient, workspaceId: string) {
  const actor = await database.actor.findFirst({ where: { workspaceId, type: "SYSTEM", userId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!actor) throw new PaymentSandboxError("PAYMENT_SYSTEM_ACTOR_MISSING", false);
  return actor;
}

export function createPaymentWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" IN ('PAYMENT_WEBHOOK', 'PAYMENT_ATTEMPT')
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY CASE WHEN "type" = 'PAYMENT_WEBHOOK' THEN 0 ELSE 1 END,
          "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000), attempts: { increment: 1 }, lastAttemptAt: now } });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function finishAttemptFailure(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: AttemptPayload, error: unknown) {
    const retryable = error instanceof PaymentSandboxError ? error.retryable : true;
    const code = error instanceof PaymentSandboxError ? error.code : "PAYMENT_SANDBOX_INTERNAL_FAILURE";
    const terminal = !retryable || job.attempts >= job.maxAttempts;
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const actor = await actorFor(tx, job.workspaceId);
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000), finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: code, lastError: terminal ? "Falha terminal controlada no sandbox local." : "Nova tentativa local agendada.", updatedByActorId: actor.id } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      const attempt = await tx.paymentAttempt.findFirst({ where: { id: payload.attemptId, workspaceId: job.workspaceId } });
      if (attempt) {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: job.attempts, failedAt: terminal ? now : null, errorCode: code, errorMessage: terminal ? "Falha terminal no sandbox local." : "Retry local agendado." } });
        await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: payload.invoiceId, attemptId: attempt.id, type: terminal ? "ATTEMPT_DEAD_LETTERED" : "ATTEMPT_RETRY_SCHEDULED", actorId: actor.id, reason: terminal ? "Limite de tentativas atingido." : "Falha transitória no sandbox local.", idempotencyKey: `payment-attempt-failure:${attempt.id}:${job.attempts}`, correlationId: attempt.correlationId, occurredAt: now, safeMetadata: { code, attempt: job.attempts, nextRetrySeconds: delay, externalEgress: false } });
      }
      if (payload.outboxId) await tx.outboxEvent.updateMany({ where: { id: payload.outboxId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: job.attempts, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do sandbox de pagamento." } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: terminal ? "payment.attempt.dead_lettered" : "payment.attempt.retry_scheduled", entityType: "PaymentAttempt", entityId: payload.attemptId, origin: "SYSTEM", changes: { code, attempt: job.attempts, nextRetrySeconds: delay, externalEgress: false } } });
      return { status: terminal ? "DEAD_LETTER" as const : "RETRY_PENDING" as const, code, delaySeconds: delay };
    });
  }

  async function processAttempt(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string) {
    const payload = parseAttemptPayload(job.payload);
    const attempt = await options.database.paymentAttempt.findFirst({ where: { id: payload.attemptId, workspaceId: job.workspaceId } });
    const invoice = await options.database.invoice.findFirst({ where: { id: payload.invoiceId, workspaceId: job.workspaceId } });
    if (!attempt || !invoice) throw new PaymentSandboxError("PAYMENT_ATTEMPT_NOT_FOUND", false);
    if (options.adapter.externalEgress) throw new PaymentSandboxError("PAYMENT_EXTERNAL_EGRESS_FORBIDDEN", false);
    const actor = await actorFor(options.database, job.workspaceId);
    await options.database.$transaction(async (tx) => {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "PROCESSING", attempts: job.attempts, errorCode: null, errorMessage: null } });
      await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt.id, type: "ATTEMPT_STARTED", actorId: actor.id, reason: "Tentativa iniciada no sandbox local.", idempotencyKey: `payment-attempt-started:${attempt.id}:${job.attempts}`, correlationId: attempt.correlationId, occurredAt: options.now(), safeMetadata: { scenario: attempt.scenario, attempt: job.attempts, externalEgress: false } });
    });
    const result = await options.adapter.submit({ attemptId: attempt.id, invoiceNumber: invoice.invoiceNumber, amountCents: attempt.amountCents, scenario: payload.scenario, attempt: job.attempts, now: options.now() });
    if (result.externalEgress || !result.simulated) throw new PaymentSandboxError("PAYMENT_EXTERNAL_EGRESS_FORBIDDEN", false);

    const receiptIds: string[] = [];
    for (const callback of result.callbacks) {
      const rawBody = JSON.stringify(callback);
      const timestamp = options.now().toISOString();
      const signature = signPaymentWebhook(timestamp, rawBody);
      const receipt = await createPaymentService(options).ingestSignedLocalWebhook(job.workspaceId, Buffer.from(rawBody), timestamp, signature);
      receiptIds.push(receipt.receiptId);
    }

    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: json({ outcome: result.outcome, receiptIds, simulated: true, externalEgress: false }), finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null, updatedByActorId: actor.id } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: result.outcome === "ACCEPTED" ? "PROVIDER_ACCEPTED" : "DECLINED", externalAttemptId: result.externalAttemptId, attempts: job.attempts, acceptedAt: result.outcome === "ACCEPTED" ? now : null, failedAt: result.outcome === "DECLINED" ? now : null, errorCode: result.outcome === "DECLINED" ? "PAYMENT_SANDBOX_DECLINED" : null, errorMessage: result.outcome === "DECLINED" ? "Recusa controlada do sandbox local." : null } });
      await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt.id, type: result.outcome === "ACCEPTED" ? "PROVIDER_ACCEPTED" : "ATTEMPT_DECLINED", actorId: actor.id, reason: result.outcome === "ACCEPTED" ? "Sandbox aceitou a tentativa; pagamento ainda depende do webhook confirmado." : "Sandbox recusou a tentativa.", idempotencyKey: `payment-attempt-result:${attempt.id}`, correlationId: attempt.correlationId, occurredAt: now, safeMetadata: { externalAttemptId: result.externalAttemptId, receiptIds, simulated: true, externalEgress: false } });
      if (payload.outboxId) await tx.outboxEvent.update({ where: { id: payload.outboxId }, data: { status: "DELIVERED_LOCAL", attempts: job.attempts, deliveredLocallyAt: now, nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: result.outcome === "ACCEPTED" ? "payment.attempt.provider_accepted_local" : "payment.attempt.declined_local", entityType: "PaymentAttempt", entityId: attempt.id, origin: "SYSTEM", changes: { receiptIds, simulated: true, externalEgress: false } } });
      return { status: result.outcome === "ACCEPTED" ? "PROVIDER_ACCEPTED" as const : "DECLINED" as const, attemptId: attempt.id, receiptIds, externalEgress: false as const };
    });
  }

  async function reviewReceipt(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: WebhookPayload, reason: "UNMATCHED_INVOICE" | "AMBIGUOUS_REFERENCE" | "AMOUNT_MISMATCH" | "CURRENCY_MISMATCH" | "OUT_OF_ORDER" | "IDEMPOTENCY_CONFLICT", safeEvidence: Readonly<Record<string, unknown>>, invoiceId?: string, attemptId?: string) {
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const actor = await actorFor(tx, job.workspaceId);
      const receipt = await tx.paymentWebhookReceipt.findFirstOrThrow({ where: { id: payload.receiptId, workspaceId: job.workspaceId } });
      const evidenceHash = receipt.payloadHash;
      const issue = await tx.paymentReconciliationIssue.upsert({
        where: { workspaceId_receiptId_reason: { workspaceId: job.workspaceId, receiptId: receipt.id, reason } },
        create: { workspaceId: job.workspaceId, receiptId: receipt.id, invoiceId: invoiceId ?? null, attemptId: attemptId ?? null, reason, evidenceHash, safeEvidence: json(safeEvidence) },
        update: { status: "OPEN", invoiceId: invoiceId ?? null, attemptId: attemptId ?? null, safeEvidence: json(safeEvidence), resolvedByActorId: null, resolutionReason: null, resolvedAt: null },
      });
      await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { status: "REVIEW_REQUIRED", attempts: job.attempts, processedAt: now, errorCode: `PAYMENT_RECONCILIATION_${reason}`, errorMessage: "Evento encaminhado para revisão manual.", lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: { reviewIssueId: issue.id, reason, externalEgress: false }, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
      await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoiceId ?? null, attemptId: attemptId ?? null, type: "RECONCILIATION_REQUIRED", actorId: actor.id, reason: `Reconciliação necessária: ${reason}.`, idempotencyKey: `payment-review:${receipt.id}:${reason}`, correlationId: receipt.correlationId, providerEventId: receipt.providerEventId, occurredAt: receipt.externalOccurredAt, safeMetadata: { issueId: issue.id, ...safeEvidence } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "payment.reconciliation.required", entityType: "PaymentReconciliationIssue", entityId: issue.id, origin: "SYSTEM", changes: { reason, receiptId: receipt.id, invoiceId: invoiceId ?? null, externalEgress: false } } });
      return { status: "REVIEW_REQUIRED" as const, reason, issueId: issue.id };
    });
  }

  async function processWebhook(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string) {
    const payload = parseWebhookPayload(job.payload);
    const receipt = await options.database.paymentWebhookReceipt.findFirst({ where: { id: payload.receiptId, workspaceId: job.workspaceId } });
    if (!receipt || receipt.signatureStatus !== "VERIFIED") throw new PaymentSandboxError("PAYMENT_WEBHOOK_RECEIPT_INVALID", false);
    const event = paymentWebhookEventSchema.parse(receipt.safePayload);
    const invoice = payload.forcedInvoiceId
      ? await options.database.invoice.findFirst({ where: { id: payload.forcedInvoiceId, workspaceId: job.workspaceId } })
      : await options.database.invoice.findFirst({ where: { invoiceNumber: event.invoiceNumber, workspaceId: job.workspaceId } });
    if (!invoice) return reviewReceipt(job, workerId, payload, "UNMATCHED_INVOICE", { invoiceNumber: event.invoiceNumber, amountCents: event.amountCents, currency: event.currency });
    const attempt = event.externalAttemptId
      ? await options.database.paymentAttempt.findFirst({ where: { workspaceId: job.workspaceId, providerKey: "LOCAL_PAYMENT_SANDBOX", externalAttemptId: event.externalAttemptId } })
      : null;
    if (event.externalAttemptId && !attempt) return reviewReceipt(job, workerId, payload, "AMBIGUOUS_REFERENCE", { externalAttemptId: event.externalAttemptId }, invoice.id);
    if (event.currency !== invoice.currency) return reviewReceipt(job, workerId, payload, "CURRENCY_MISMATCH", { expected: invoice.currency, received: event.currency }, invoice.id, attempt?.id);
    const amount = BigInt(event.amountCents);

    if (event.eventType === "PAYMENT_CONFIRMED") {
      const outstanding = invoice.totalCents - invoice.paidCents;
      if (amount > outstanding || amount <= 0n) return reviewReceipt(job, workerId, payload, "AMOUNT_MISMATCH", { outstandingCents: outstanding.toString(), receivedCents: amount.toString() }, invoice.id, attempt?.id);
    } else {
      const payment = await options.database.payment.findFirst({ where: { workspaceId: job.workspaceId, providerKey: "LOCAL_PAYMENT_SANDBOX", externalPaymentId: event.externalPaymentId } });
      if (!payment || payment.status !== "CONFIRMED") return reviewReceipt(job, workerId, payload, "OUT_OF_ORDER", { eventType: event.eventType, externalPaymentId: event.externalPaymentId }, invoice.id, attempt?.id);
      if (amount !== payment.amountCents) return reviewReceipt(job, workerId, payload, "AMOUNT_MISMATCH", { confirmedCents: payment.amountCents.toString(), receivedCents: amount.toString() }, invoice.id, attempt?.id);
    }

    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${job.workspaceId}:${invoice.id}`}, 0))`;
      const actor = await actorFor(tx, job.workspaceId);
      const currentInvoice = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id, workspaceId: job.workspaceId } });
      const priorEvent = await tx.paymentEvent.findUnique({ where: { workspaceId_providerEventId: { workspaceId: job.workspaceId, providerEventId: event.eventId } } });
      if (priorEvent) {
        await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { status: "PROCESSED", processedAt: options.now(), attempts: job.attempts } });
        await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", finishedAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
        return { status: "DUPLICATE" as const, eventId: priorEvent.id };
      }

      if (event.eventType === "PAYMENT_CONFIRMED") {
        const currentOutstanding = currentInvoice.totalCents - currentInvoice.paidCents;
        if (amount <= 0n || amount > currentOutstanding) {
          const evidence = { outstandingCents: currentOutstanding.toString(), receivedCents: amount.toString(), detectedAfterLock: true };
          const issue = await tx.paymentReconciliationIssue.upsert({
            where: { workspaceId_receiptId_reason: { workspaceId: job.workspaceId, receiptId: receipt.id, reason: "AMOUNT_MISMATCH" } },
            create: { workspaceId: job.workspaceId, receiptId: receipt.id, invoiceId: invoice.id, attemptId: attempt?.id ?? null, reason: "AMOUNT_MISMATCH", evidenceHash: receipt.payloadHash, safeEvidence: json(evidence), ownerMemberId: currentInvoice.ownerMemberId },
            update: { status: "OPEN", invoiceId: invoice.id, attemptId: attempt?.id ?? null, safeEvidence: json(evidence), resolvedByActorId: null, resolutionReason: null, resolvedAt: null },
          });
          const now = options.now();
          await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { status: "REVIEW_REQUIRED", attempts: job.attempts, processedAt: now, errorCode: "PAYMENT_RECONCILIATION_AMOUNT_MISMATCH", errorMessage: "Saldo alterado durante reconciliação concorrente." } });
          await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: { reviewIssueId: issue.id, reason: "AMOUNT_MISMATCH", externalEgress: false }, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
          await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt?.id ?? null, type: "RECONCILIATION_REQUIRED", actorId: actor.id, reason: "Reconciliação necessária: AMOUNT_MISMATCH após lock.", idempotencyKey: `payment-review:${receipt.id}:AMOUNT_MISMATCH`, correlationId: receipt.correlationId, providerEventId: receipt.providerEventId, occurredAt: receipt.externalOccurredAt, safeMetadata: { issueId: issue.id, ...evidence } });
          await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "payment.reconciliation.required", entityType: "PaymentReconciliationIssue", entityId: issue.id, origin: "SYSTEM", changes: { reason: "AMOUNT_MISMATCH", receiptId: receipt.id, invoiceId: invoice.id, externalEgress: false } } });
          return { status: "REVIEW_REQUIRED" as const, reason: "AMOUNT_MISMATCH" as const, issueId: issue.id };
        }
        const payment = await tx.payment.create({ data: { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt?.id ?? null, amountCents: amount, currency: event.currency, status: "CONFIRMED", providerKey: "LOCAL_PAYMENT_SANDBOX", externalPaymentId: event.externalPaymentId, idempotencyKey: `payment-confirmed:${event.eventId}`, correlationId: receipt.correlationId, causationId: attempt?.id ?? null, occurredAt: new Date(event.occurredAt), recordedAt: options.now(), confirmedByActorId: actor.id } });
        const paidCents = currentInvoice.paidCents + amount;
        const status = invoiceStatusAfterPayment(currentInvoice.totalCents, paidCents);
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidCents, status, paidAt: status === "PAID" ? new Date(event.occurredAt) : null, revision: { increment: 1 }, updatedByActorId: actor.id } });
        if (attempt) await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", confirmedAt: new Date(event.occurredAt) } });
        await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt?.id ?? null, paymentId: payment.id, type: "PAYMENT_CONFIRMED", actorId: actor.id, reason: "Pagamento confirmado por webhook local assinado e reconciliado.", idempotencyKey: `payment-event:${event.eventId}`, correlationId: receipt.correlationId, causationId: attempt?.id ?? null, providerEventId: event.eventId, occurredAt: new Date(event.occurredAt), safeMetadata: { amountCents: amount.toString(), currency: event.currency, externalEgress: false, revenueMovementCreated: false } });
      } else {
        const payment = await tx.payment.findFirstOrThrow({ where: { workspaceId: job.workspaceId, providerKey: "LOCAL_PAYMENT_SANDBOX", externalPaymentId: event.externalPaymentId } });
        const nextPaymentStatus = event.eventType === "CHARGEBACK_RECORDED" ? "CHARGEBACK" : "REVERSED";
        await tx.payment.update({ where: { id: payment.id }, data: { status: nextPaymentStatus, reversedAt: new Date(event.occurredAt), reversalReason: event.reasonCode ?? event.eventType } });
        const paidCents = currentInvoice.paidCents >= amount ? currentInvoice.paidCents - amount : 0n;
        const status = invoiceStatusAfterPayment(currentInvoice.totalCents, paidCents);
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidCents, status, paidAt: null, revision: { increment: 1 }, updatedByActorId: actor.id } });
        await appendPaymentEventInTransaction(tx, { workspaceId: job.workspaceId, invoiceId: invoice.id, attemptId: attempt?.id ?? null, paymentId: payment.id, type: event.eventType, actorId: actor.id, reason: event.reasonCode ?? "Evento compensatório recebido.", idempotencyKey: `payment-event:${event.eventId}`, correlationId: receipt.correlationId, providerEventId: event.eventId, occurredAt: new Date(event.occurredAt), safeMetadata: { amountCents: amount.toString(), currency: event.currency, externalEgress: false, revenueMovementCreated: false } });
      }
      await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { status: "PROCESSED", processedAt: options.now(), attempts: job.attempts, errorCode: null, errorMessage: null, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: { eventType: event.eventType, invoiceId: invoice.id, externalEgress: false }, finishedAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null, updatedByActorId: actor.id } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: `payment.webhook.${event.eventType.toLowerCase()}`, entityType: "Invoice", entityId: invoice.id, origin: "SYSTEM", requestId: event.eventId, changes: { amountCents: amount.toString(), currency: event.currency, receiptId: receipt.id, externalEgress: false, revenueMovementCreated: false } } });
      return { status: "PROCESSED" as const, invoiceId: invoice.id, eventType: event.eventType };
    });
  }

  async function finishWebhookFailure(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, error: unknown) {
    const payload = (() => { try { return parseWebhookPayload(job.payload); } catch { return null; } })();
    const retryable = error instanceof PaymentSandboxError ? error.retryable : true;
    const code = error instanceof PaymentSandboxError ? error.code : "PAYMENT_WEBHOOK_INTERNAL_FAILURE";
    const terminal = !retryable || job.attempts >= job.maxAttempts;
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const actor = await actorFor(tx, job.workspaceId);
      const changed = await tx.job.updateMany({ where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000), finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: code, lastError: terminal ? "Webhook em dead-letter local." : "Retry local de webhook agendado.", updatedByActorId: actor.id } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      if (payload) await tx.paymentWebhookReceipt.updateMany({ where: { id: payload.receiptId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: job.attempts, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorCode: code, errorMessage: "Falha controlada no processamento local." } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: terminal ? "payment.webhook.dead_lettered" : "payment.webhook.retry_scheduled", entityType: "PaymentWebhookReceipt", entityId: payload?.receiptId ?? job.id, origin: "SYSTEM", changes: { code, attempt: job.attempts, nextRetrySeconds: delay, externalEgress: false } } });
      return { status: terminal ? "DEAD_LETTER" as const : "RETRY_PENDING" as const, code, delaySeconds: delay };
    });
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    try {
      return job.type === "PAYMENT_ATTEMPT" ? await processAttempt(job, workerId) : await processWebhook(job, workerId);
    } catch (error) {
      if (job.type === "PAYMENT_ATTEMPT") {
        try { return await finishAttemptFailure(job, workerId, parseAttemptPayload(job.payload), error); }
        catch { return finishWebhookFailure(job, workerId, error); }
      }
      return finishWebhookFailure(job, workerId, error);
    }
  }

  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createPaymentWorkerService> | undefined;
export function getPaymentWorkerService() {
  service ??= createPaymentWorkerService({ database: getDatabaseClient(), adapter: localPaymentSandbox, now: () => new Date() });
  return service;
}
