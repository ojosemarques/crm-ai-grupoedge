import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { reconcileCommissionsInTransaction } from "@/modules/finance/application/finance-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import {
  createInvoiceSchema,
  invoiceActionSchema,
  invoiceTotalCents,
  invoiceStatusAfterPayment,
  MANUAL_RECEIPT_PROVIDER_KEY,
  previewReceiptSchema,
  recordReceiptSchema,
  outstandingCents,
  PAYMENT_CONTRACT_VERSION,
  PAYMENT_JOB_MAX_ATTEMPTS,
  PAYMENT_MAX_WEBHOOK_BYTES,
  PAYMENT_PROVIDER_KEY,
  paymentWebhookEventSchema,
  reconciliationResolutionSchema,
  verifyPaymentWebhook,
} from "@/modules/payments/domain/payment-contracts";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resource(context: Pick<AuthenticatedContext, "workspaceId">, id?: string, ownerMemberId?: string | null): ResourceScope {
  return {
    workspaceId: context.workspaceId,
    resourceType: "Payment",
    resourceId: id ?? context.workspaceId,
    ...(ownerMemberId === undefined ? {} : { ownerMemberId }),
  };
}

async function systemActor(tx: Tx, workspaceId: string) {
  const actor = await tx.actor.findFirst({
    where: { workspaceId, type: "SYSTEM", userId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!actor) fail("Ator Sistema não configurado.", "PAYMENT_SYSTEM_ACTOR_MISSING");
  return actor;
}

export async function appendPaymentEventInTransaction(
  tx: Tx,
  input: Readonly<{
    workspaceId: string;
    invoiceId?: string | null;
    attemptId?: string | null;
    paymentId?: string | null;
    type:
      | "INVOICE_CREATED"
      | "INVOICE_ISSUED"
      | "INVOICE_VOIDED"
      | "ATTEMPT_QUEUED"
      | "ATTEMPT_STARTED"
      | "PROVIDER_ACCEPTED"
      | "ATTEMPT_DECLINED"
      | "ATTEMPT_RETRY_SCHEDULED"
      | "ATTEMPT_DEAD_LETTERED"
      | "PAYMENT_CONFIRMED"
      | "PAYMENT_REVERSED"
      | "CHARGEBACK_RECORDED"
      | "RECONCILIATION_REQUIRED"
      | "RECONCILIATION_RESOLVED"
      | "REPLAY_REQUESTED";
    actorId: string;
    reason: string;
    idempotencyKey: string;
    correlationId: string;
    causationId?: string | null;
    providerEventId?: string | null;
    occurredAt: Date;
    safeMetadata?: Readonly<Record<string, unknown>>;
  }>,
) {
  const existing = await tx.paymentEvent.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;
  const sequenceKey = input.invoiceId ?? input.correlationId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-event:${input.workspaceId}:${sequenceKey}`}, 0))`;
  const last = input.invoiceId
    ? await tx.paymentEvent.findFirst({ where: { workspaceId: input.workspaceId, invoiceId: input.invoiceId }, orderBy: [{ sequence: "desc" }, { id: "desc" }] })
    : null;
  const event = await tx.paymentEvent.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId ?? null,
      attemptId: input.attemptId ?? null,
      paymentId: input.paymentId ?? null,
      sequence: (last?.sequence ?? 0) + 1,
      type: input.type,
      providerEventId: input.providerEventId ?? null,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      reason: input.reason,
      safeMetadata: input.safeMetadata ? json(input.safeMetadata) : Prisma.JsonNull,
    },
  });
  if (input.type === "INVOICE_ISSUED" || input.type === "PAYMENT_CONFIRMED" || input.type === "PAYMENT_REVERSED") {
    const [invoice, payment, actor] = await Promise.all([
      input.invoiceId ? tx.invoice.findFirst({ where: { id: input.invoiceId, workspaceId: input.workspaceId }, select: { id: true, accountId: true, contractId: true, ownerMemberId: true, totalCents: true } }) : null,
      input.paymentId ? tx.payment.findFirst({ where: { id: input.paymentId, workspaceId: input.workspaceId }, select: { id: true, amountCents: true } }) : null,
      tx.actor.findFirst({ where: { id: input.actorId, workspaceId: input.workspaceId }, select: { type: true, userId: true } }),
    ]);
    const member = actor?.userId ? await tx.workspaceMember.findFirst({ where: { workspaceId: input.workspaceId, userId: actor.userId, deletedAt: null }, select: { id: true } }) : null;
    const metricType = input.type === "INVOICE_ISSUED" ? "INVOICE_ISSUED" as const : input.type === "PAYMENT_CONFIRMED" ? "PAYMENT_CONFIRMED" as const : "PAYMENT_REVERSED" as const;
    const rawValue = input.type === "INVOICE_ISSUED" ? invoice?.totalCents ?? null : payment?.amountCents ?? null;
    await recordCommercialMetricFactInTransaction(tx, {
      workspaceId: input.workspaceId,
      eventKey: `payment-event:${event.id}:${metricType.toLowerCase()}:v1`,
      eventType: metricType,
      occurredAt: input.occurredAt,
      sourceEntityType: "PaymentEvent",
      sourceEntityId: event.id,
      accountId: invoice?.accountId ?? null,
      contractId: invoice?.contractId ?? null,
      paymentId: input.paymentId ?? null,
      creditedMemberId: invoice?.ownerMemberId ?? null,
      performedByMemberId: member?.id ?? null,
      valueCents: input.type === "PAYMENT_REVERSED" && rawValue !== null ? -rawValue : rawValue,
      result: input.type,
      executionMode: actor?.type === "HUMAN" ? "MANUAL" : actor?.type === "AUTOMATION" ? "AUTOMATION" : "SYSTEM",
      safeMetadata: { invoiceId: input.invoiceId ?? null, correlationId: input.correlationId },
    });
  }
  return event;
}

export function createPaymentService(options: Options) {
  const authorization = createAuthorizationService({ database: options.database });

  async function receiptResources(context: AuthenticatedContext, input: ReturnType<typeof previewReceiptSchema.parse>, database: Tx | PrismaClient) {
    const invoice = await database.invoice.findFirst({ where: { id: input.invoiceId, workspaceId: context.workspaceId } });
    if (!invoice) fail("Cobrança não encontrada.", "PAYMENT_INVOICE_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, invoice.id, invoice.ownerMemberId));
    await authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, { workspaceId: context.workspaceId, resourceType: "Finance", resourceId: context.workspaceId });
    const account = await database.financialAccount.findFirst({ where: { id: input.financialAccountId, workspaceId: context.workspaceId, active: true } });
    if (!account) fail("Conta financeira ativa não encontrada.", "FINANCE_ACCOUNT_NOT_FOUND", 404);
    return { invoice, account };
  }

  function validateReceipt(input: ReturnType<typeof previewReceiptSchema.parse>, invoice: Awaited<ReturnType<typeof receiptResources>>["invoice"]) {
    if (!["OPEN", "PARTIALLY_PAID"].includes(invoice.status)) fail("A cobrança não está aberta para recebimento.", "PAYMENT_INVALID_INVOICE_TRANSITION");
    if (input.expectedRevision !== undefined && invoice.revision !== input.expectedRevision) fail("A cobrança mudou. Revise uma nova prévia antes de confirmar.", "PAYMENT_VERSION_CONFLICT");
    if (input.amountCents > outstandingCents(invoice.totalCents, invoice.paidCents)) fail("O recebimento excede o saldo da cobrança.", "PAYMENT_RECEIPT_OVERPAYMENT");
    if (input.receivedAt > options.now()) fail("A data do recebimento não pode estar no futuro.", "PAYMENT_RECEIPT_FUTURE_DATE", 400);
  }

  async function previewReceipt(context: AuthenticatedContext, raw: unknown) {
    const input = previewReceiptSchema.parse(raw);
    const { invoice, account } = await receiptResources(context, input, options.database);
    validateReceipt(input, invoice);
    return {
      input: { ...input, amountCents: input.amountCents.toString(), receivedAt: input.receivedAt.toISOString(), expectedRevision: invoice.revision },
      preview: { invoiceNumber: invoice.invoiceNumber, customerName: invoice.accountNameSnapshot, financialAccountName: account.name, amountCents: input.amountCents.toString(), receivedAt: input.receivedAt.toISOString(), method: input.method, reference: input.reference, outstandingBeforeCents: (invoice.totalCents - invoice.paidCents).toString(), outstandingAfterCents: (invoice.totalCents - invoice.paidCents - input.amountCents).toString(), statusAfter: invoiceStatusAfterPayment(invoice.totalCents, invoice.paidCents + input.amountCents), effect: "Registra dinheiro já recebido, baixa a cobrança e atualiza caixa e indicadores. Não altera o MRR contratado nem movimenta dinheiro no banco." },
    };
  }

  async function recordReceipt(context: AuthenticatedContext, raw: unknown) {
    const input = recordReceiptSchema.parse(raw);
    const eventKey = `manual-receipt:${input.idempotencyKey}`;
    const requestHash = sha256(canonicalJson({ invoiceId: input.invoiceId, financialAccountId: input.financialAccountId, expectedRevision: input.expectedRevision, amountCents: input.amountCents.toString(), receivedAt: input.receivedAt.toISOString(), method: input.method, reference: input.reference }));
    const externalPaymentId = sha256(canonicalJson({ financialAccountId: input.financialAccountId, reference: input.reference.toLocaleLowerCase("pt-BR") }));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-receipt:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-receipt-reference:${context.workspaceId}:${externalPaymentId}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice:${context.workspaceId}:${input.invoiceId}`}, 0))`;
      const { invoice, account } = await receiptResources(context, input, tx);
      const replay = await tx.paymentEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: eventKey } } });
      if (replay?.paymentId) {
        const metadata = replay.safeMetadata as Record<string, unknown> | null;
        if (metadata?.requestHash !== requestHash) fail("A confirmação já foi usada com outros dados.", "PAYMENT_RECEIPT_IDEMPOTENCY_CONFLICT");
        const payment = await tx.payment.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: replay.paymentId, invoiceId: invoice.id } });
        return { invoice, payment, idempotent: true };
      }
      validateReceipt(input, invoice);
      const duplicate = await tx.payment.findUnique({ where: { workspaceId_providerKey_externalPaymentId: { workspaceId: context.workspaceId, providerKey: MANUAL_RECEIPT_PROVIDER_KEY, externalPaymentId } } });
      if (duplicate) fail("Esta referência já foi registrada nesta conta financeira.", "PAYMENT_RECEIPT_DUPLICATE_REFERENCE");
      const payment = await tx.payment.create({ data: { workspaceId: context.workspaceId, invoiceId: invoice.id, amountCents: input.amountCents, currency: invoice.currency, providerKey: MANUAL_RECEIPT_PROVIDER_KEY, externalPaymentId, idempotencyKey: eventKey, correlationId: `invoice:${invoice.id}`, occurredAt: input.receivedAt, confirmedByActorId: context.actorId } });
      const paidCents = invoice.paidCents + input.amountCents;
      const status = invoiceStatusAfterPayment(invoice.totalCents, paidCents);
      const changed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: context.workspaceId, revision: input.expectedRevision }, data: { paidCents, status, paidAt: status === "PAID" ? input.receivedAt : null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (changed.count !== 1) fail("A cobrança mudou. Revise uma nova prévia.", "PAYMENT_VERSION_CONFLICT");
      const metadata = { providerKey: MANUAL_RECEIPT_PROVIDER_KEY, financialAccountId: account.id, financialAccountName: account.name, customerAccountId: invoice.accountId, customerName: invoice.accountNameSnapshot, method: input.method, reference: input.reference, amountCents: input.amountCents.toString(), receivedAt: input.receivedAt.toISOString(), requestHash, receiptConfirmed: true };
      await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId: invoice.id, paymentId: payment.id, type: "PAYMENT_CONFIRMED", actorId: context.actorId, reason: `Recebimento confirmado pelo operador via ${input.method}. Referência: ${input.reference}`, idempotencyKey: eventKey, correlationId: payment.correlationId, occurredAt: input.receivedAt, safeMetadata: metadata });
      await reconcileCommissionsInTransaction(tx, context, input.receivedAt);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.receipt.recorded", entityType: "Payment", entityId: payment.id, origin: "DOMAIN", changes: { ...metadata, invoiceId: invoice.id, previousPaidCents: invoice.paidCents.toString(), paidCents: paidCents.toString(), previousStatus: invoice.status, status } } });
      const updated = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id, workspaceId: context.workspaceId } });
      return { invoice: updated, payment, idempotent: false };
    }, { isolationLevel: "ReadCommitted" });
  }

  async function nextInvoiceNumber(tx: Tx, workspaceId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice-number:${workspaceId}`}, 0))`;
    const rows = await tx.$queryRaw<Array<{ allocated: bigint }>>`
      INSERT INTO invoice_number_sequences ("workspaceId", "nextValue", "updatedAt")
      VALUES (${workspaceId}::uuid, 2, NOW())
      ON CONFLICT ("workspaceId") DO UPDATE
      SET "nextValue" = invoice_number_sequences."nextValue" + 1, "updatedAt" = NOW()
      RETURNING "nextValue" - 1 AS allocated
    `;
    return `INV-${options.now().getUTCFullYear()}-${rows[0]!.allocated.toString().padStart(6, "0")}`;
  }

  async function visibleInvoices(context: AuthenticatedContext) {
    const accessProbe = resource(context, undefined, context.memberId);
    const decision = await authorization.authorize(context, PermissionKeys.PAYMENTS_READ, accessProbe);
    if (!decision.allowed) await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, accessProbe);
    if (!decision.allowed) return [];
    const rows = await options.database.invoice.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] });
    if (decision.scope === "WORKSPACE") return rows;
    const visible = [];
    for (const row of rows) {
      if ((await authorization.authorize(context, PermissionKeys.PAYMENTS_READ, resource(context, row.id, row.ownerMemberId))).allowed) visible.push(row);
    }
    return visible;
  }

  async function screen(context: AuthenticatedContext, filters: Readonly<{ query?: string; status?: string }> = {}) {
    const rows = await visibleInvoices(context);
    const subscriptions = await options.database.subscription.findMany({
      where: { workspaceId: context.workspaceId, status: { in: ["ACTIVE", "CANCELLATION_SCHEDULED"] } },
      orderBy: [{ accountNameSnapshot: "asc" }, { subscriptionNumber: "asc" }],
    });
    const eligibleSubscriptions = [];
    for (const subscription of subscriptions) {
      if ((await authorization.authorize(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, subscription.id, subscription.ownerMemberId))).allowed) {
        eligibleSubscriptions.push({
          id: subscription.id,
          subscriptionNumber: subscription.subscriptionNumber,
          accountName: subscription.accountNameSnapshot,
          productName: subscription.productNameSnapshot,
          recurringPriceCents: subscription.recurringPriceCents.toString(),
          quantity: subscription.quantity,
        });
      }
    }
    const normalizedQuery = filters.query?.trim().toLocaleLowerCase("pt-BR") ?? "";
    const filtered = rows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      return !normalizedQuery || [row.invoiceNumber, row.accountNameSnapshot, row.contractNumberSnapshot, row.descriptionSnapshot]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
    const invoiceIds = rows.map(({ id }) => id);
    const [confirmedPayments, declines, reconciliationCandidates, permissions] = await Promise.all([
      options.database.payment.aggregate({ where: { workspaceId: context.workspaceId, invoiceId: { in: invoiceIds }, status: "CONFIRMED", providerKey: { not: PAYMENT_PROVIDER_KEY } }, _sum: { amountCents: true }, _count: { _all: true } }),
      options.database.paymentAttempt.count({ where: { workspaceId: context.workspaceId, invoiceId: { in: invoiceIds }, status: "DECLINED" } }),
      options.database.paymentReconciliationIssue.findMany({ where: { workspaceId: context.workspaceId, status: "OPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      Promise.all([
        authorization.authorize(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, undefined, context.memberId)),
        authorization.authorize(context, PermissionKeys.PAYMENTS_REPROCESS, resource(context, undefined, context.memberId)),
        authorization.authorize(context, PermissionKeys.PAYMENTS_RECONCILE, resource(context, undefined, context.memberId)),
      ]),
    ]);
    const reconciliationIssues = [];
    for (const issue of reconciliationCandidates) {
      if ((await authorization.authorize(context, PermissionKeys.PAYMENTS_RECONCILE, resource(context, issue.id, issue.ownerMemberId))).allowed) {
        reconciliationIssues.push({ id: issue.id, reason: issue.reason, receiptId: issue.receiptId, invoiceId: issue.invoiceId, createdAt: issue.createdAt.toISOString() });
      }
    }
    const now = options.now();
    return {
      generatedAt: now.toISOString(),
      currency: "BRL" as const,
      mode: "MANUAL_RECEIPTS" as const,
      externalEgress: false as const,
      metrics: {
        openCount: rows.filter(({ status }) => status === "OPEN" || status === "PARTIALLY_PAID").length,
        overdueCount: rows.filter((row) => (row.status === "OPEN" || row.status === "PARTIALLY_PAID") && row.dueAt < now).length,
        confirmedCount: confirmedPayments._count._all,
        confirmedCents: (confirmedPayments._sum.amountCents ?? 0n).toString(),
        declinedCount: declines,
        divergenceCount: reconciliationIssues.length,
      },
      invoices: filtered.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        accountName: row.accountNameSnapshot,
        description: row.descriptionSnapshot,
        status: row.status,
        totalCents: row.totalCents.toString(),
        paidCents: row.paidCents.toString(),
        outstandingCents: outstandingCents(row.totalCents, row.paidCents).toString(),
        dueAt: row.dueAt.toISOString(),
        overdue: (row.status === "OPEN" || row.status === "PARTIALLY_PAID") && row.dueAt < now,
        revision: row.revision,
      })),
      eligibleSubscriptions,
      reconciliationIssues,
      reconciliationInvoiceOptions: rows.map((row) => ({ id: row.id, invoiceNumber: row.invoiceNumber, accountName: row.accountNameSnapshot })),
      permissions: { manage: permissions[0].allowed, reprocess: permissions[1].allowed, reconcile: permissions[2].allowed },
    };
  }

  async function detail(context: AuthenticatedContext, invoiceId: string) {
    const invoice = await options.database.invoice.findFirst({ where: { id: invoiceId, workspaceId: context.workspaceId } });
    if (!invoice) fail("Cobrança não encontrada.", "PAYMENT_INVOICE_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, resource(context, invoice.id, invoice.ownerMemberId));
    const [lines, attempts, payments, events, issues, permissions] = await Promise.all([
      options.database.invoiceLine.findMany({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: { position: "asc" } }),
      options.database.paymentAttempt.findMany({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: { sequence: "desc" } }),
      options.database.payment.findMany({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
      options.database.paymentEvent.findMany({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: [{ sequence: "desc" }, { id: "desc" }] }),
      options.database.paymentReconciliationIssue.findMany({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      Promise.all([
        authorization.authorize(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, invoice.id, invoice.ownerMemberId)),
        authorization.authorize(context, PermissionKeys.PAYMENTS_REPROCESS, resource(context, invoice.id, invoice.ownerMemberId)),
        authorization.authorize(context, PermissionKeys.PAYMENTS_RECONCILE, resource(context, invoice.id, invoice.ownerMemberId)),
      ]),
    ]);
    const canRecordReceipt = permissions[0].allowed && (await authorization.authorize(context, PermissionKeys.FINANCE_MANAGE, { workspaceId: context.workspaceId, resourceType: "Finance", resourceId: context.workspaceId })).allowed;
    const financialAccounts = canRecordReceipt ? await options.database.financialAccount.findMany({ where: { workspaceId: context.workspaceId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
    return { invoice, lines, attempts, payments, events, issues, financialAccounts, permissions: { manage: permissions[0].allowed, recordReceipt: canRecordReceipt, reprocess: permissions[1].allowed, reconcile: permissions[2].allowed }, mode: "MANUAL_RECEIPTS" as const, sandboxEnabled: process.env.NODE_ENV !== "production", externalEgress: false as const };
  }

  async function createInvoice(context: AuthenticatedContext, raw: unknown) {
    const input = createInvoiceSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice-create:${context.workspaceId}:${input.subscriptionId}:${input.billingPeriodStart.toISOString()}:${input.billingPeriodEnd.toISOString()}`}, 0))`;
      const subscription = await tx.subscription.findFirst({ where: { id: input.subscriptionId, workspaceId: context.workspaceId } });
      if (!subscription) fail("Assinatura não encontrada.", "PAYMENT_SUBSCRIPTION_NOT_FOUND", 404);
      await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, undefined, subscription.ownerMemberId));
      if (!["ACTIVE", "CANCELLATION_SCHEDULED"].includes(subscription.status)) fail("Somente assinatura ativa pode originar cobrança.", "PAYMENT_SUBSCRIPTION_NOT_BILLABLE");
      const replay = await tx.paymentEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay?.invoiceId) {
        const replayInvoice = await tx.invoice.findFirstOrThrow({ where: { id: replay.invoiceId, workspaceId: context.workspaceId } });
        await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, replayInvoice.id, replayInvoice.ownerMemberId));
        if (replay.type !== "INVOICE_CREATED" || replayInvoice.subscriptionId !== input.subscriptionId) fail("A chave já pertence a outra operação de cobrança.", "PAYMENT_INVOICE_IDEMPOTENCY_CONFLICT");
        return replayInvoice;
      }
      const existing = await tx.invoice.findFirst({ where: { workspaceId: context.workspaceId, subscriptionId: subscription.id, billingPeriodStart: input.billingPeriodStart, billingPeriodEnd: input.billingPeriodEnd } });
      if (existing) {
        await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, existing.id, existing.ownerMemberId));
        return existing;
      }
      const subtotal = BigInt(subscription.quantity) * subscription.recurringPriceCents + input.upfrontCents;
      const total = invoiceTotalCents(subtotal, 0n);
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("O valor da cobrança excede o limite seguro do sandbox local.", "PAYMENT_AMOUNT_TOO_LARGE");
      const invoice = await tx.invoice.create({ data: {
        workspaceId: context.workspaceId,
        invoiceNumber: await nextInvoiceNumber(tx, context.workspaceId),
        subscriptionId: subscription.id,
        contractId: subscription.contractId,
        accountId: subscription.accountId,
        ownerMemberId: subscription.ownerMemberId,
        accountNameSnapshot: subscription.accountNameSnapshot,
        contractNumberSnapshot: subscription.contractNumberSnapshot,
        descriptionSnapshot: input.description ?? subscription.productNameSnapshot,
        currency: subscription.currency,
        subtotalCents: subtotal,
        discountCents: 0n,
        totalCents: total,
        paidCents: 0n,
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        dueAt: input.dueAt,
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
      } });
      await tx.invoiceLine.create({ data: { workspaceId: context.workspaceId, invoiceId: invoice.id, position: 1, descriptionSnapshot: invoice.descriptionSnapshot, quantity: subscription.quantity, unitPriceCents: subscription.recurringPriceCents, discountCents: 0n, totalCents: BigInt(subscription.quantity) * subscription.recurringPriceCents, currency: subscription.currency } });
      if (input.upfrontCents > 0n) await tx.invoiceLine.create({ data: { workspaceId: context.workspaceId, invoiceId: invoice.id, position: 2, descriptionSnapshot: "Entrada contratual", quantity: 1, unitPriceCents: input.upfrontCents, discountCents: 0n, totalCents: input.upfrontCents, currency: subscription.currency } });
      await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId: invoice.id, type: "INVOICE_CREATED", actorId: context.actorId, reason: "Cobrança criada explicitamente a partir da assinatura.", idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, occurredAt: options.now(), safeMetadata: { subscriptionId: subscription.id, totalCents: total.toString(), currency: subscription.currency } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.invoice.created", entityType: "Invoice", entityId: invoice.id, origin: "DOMAIN", changes: { subscriptionId: subscription.id, totalCents: total.toString(), currency: subscription.currency, status: "DRAFT" } } });
      return invoice;
    }, { isolationLevel: "ReadCommitted" });
  }

  async function act(context: AuthenticatedContext, invoiceId: string, raw: unknown) {
    const input = invoiceActionSchema.parse(raw);
    if (process.env.NODE_ENV === "production" && (input.action === "CHARGE" || input.action === "REPLAY")) fail("Simulações de pagamento não estão disponíveis em produção.", "PAYMENT_SANDBOX_DISABLED_IN_PRODUCTION", 403);
    if (input.action === "REPLAY") return replayAttempt(context, invoiceId, input.attemptId, input.reason);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice:${context.workspaceId}:${invoiceId}`}, 0))`;
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId: context.workspaceId } });
      if (!invoice) fail("Cobrança não encontrada.", "PAYMENT_INVOICE_NOT_FOUND", 404);
      await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, invoice.id, invoice.ownerMemberId));
      if (input.action === "ISSUE") {
        if (invoice.status !== "DRAFT") fail("Somente cobrança em rascunho pode ser emitida.", "PAYMENT_INVALID_INVOICE_TRANSITION");
        if (invoice.revision !== input.expectedRevision) fail("A cobrança foi alterada; atualize a página.", "PAYMENT_VERSION_CONFLICT");
        const updated = await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OPEN", issuedAt: options.now(), revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId, type: "INVOICE_ISSUED", actorId: context.actorId, reason: input.reason, idempotencyKey: `invoice-issued:${invoice.id}:r${updated.revision}`, correlationId: `invoice:${invoice.id}`, occurredAt: options.now() });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.invoice.issued", entityType: "Invoice", entityId: invoice.id, origin: "DOMAIN", changes: { previousStatus: "DRAFT", newStatus: "OPEN", reason: input.reason } } });
        return { invoice: updated, status: "OPEN" as const };
      }
      if (input.action === "VOID") {
        if (!["DRAFT", "OPEN"].includes(invoice.status) || invoice.paidCents !== 0n) fail("Cobrança paga ou encerrada não pode ser anulada.", "PAYMENT_INVALID_INVOICE_TRANSITION");
        if (invoice.revision !== input.expectedRevision) fail("A cobrança foi alterada; atualize a página.", "PAYMENT_VERSION_CONFLICT");
        const updated = await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOIDED", voidedAt: options.now(), revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await tx.paymentAttempt.updateMany({ where: { workspaceId: context.workspaceId, invoiceId, status: { in: ["QUEUED", "RETRY_PENDING"] } }, data: { status: "CANCELLED", failedAt: options.now(), errorCode: "INVOICE_VOIDED", errorMessage: "Cobrança anulada pelo operador." } });
        await tx.job.updateMany({ where: { workspaceId: context.workspaceId, type: "PAYMENT_ATTEMPT", status: "PENDING", payload: { path: ["invoiceId"], equals: invoiceId } }, data: { status: "CANCELLED", finishedAt: options.now(), cancelledAt: options.now(), updatedByActorId: context.actorId } });
        await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId, type: "INVOICE_VOIDED", actorId: context.actorId, reason: input.reason, idempotencyKey: `invoice-voided:${invoice.id}:r${updated.revision}`, correlationId: `invoice:${invoice.id}`, occurredAt: options.now() });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.invoice.voided", entityType: "Invoice", entityId: invoice.id, origin: "DOMAIN", changes: { previousStatus: invoice.status, newStatus: "VOIDED", reason: input.reason } } });
        return { invoice: updated, status: "VOIDED" as const };
      }
      if (!["OPEN", "PARTIALLY_PAID"].includes(invoice.status)) fail("A cobrança não está aberta para pagamento.", "PAYMENT_INVALID_INVOICE_TRANSITION");
      if (invoice.revision !== input.expectedRevision) fail("A cobrança foi alterada; atualize a página.", "PAYMENT_VERSION_CONFLICT");
      const amount = outstandingCents(invoice.totalCents, invoice.paidCents);
      if (amount <= 0n) fail("A cobrança não possui saldo pendente.", "PAYMENT_NO_OUTSTANDING_BALANCE");
      const replay = await tx.paymentAttempt.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) return { attempt: replay, status: replay.status, idempotent: true };
      const last = await tx.paymentAttempt.findFirst({ where: { workspaceId: context.workspaceId, invoiceId }, orderBy: [{ sequence: "desc" }, { id: "desc" }] });
      const attempt = await tx.paymentAttempt.create({ data: { workspaceId: context.workspaceId, invoiceId, sequence: (last?.sequence ?? 0) + 1, scenario: input.scenario, status: "QUEUED", amountCents: amount, currency: invoice.currency, idempotencyKey: input.idempotencyKey, correlationId: `invoice:${invoice.id}`, createdByActorId: context.actorId } });
      const payload = { attemptId: attempt.id, invoiceId: invoice.id, scenario: input.scenario, externalEgress: false };
      const outbox = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, eventType: "payment.attempt.requested", eventVersion: PAYMENT_CONTRACT_VERSION, aggregateType: "Invoice", aggregateId: invoice.id, correlationId: attempt.correlationId, idempotencyKey: `payment-outbox:${attempt.id}`, payload: json(payload), payloadHash: sha256(canonicalJson(payload)), createdByActorId: context.actorId } });
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "PAYMENT_ATTEMPT", idempotencyKey: `payment-attempt-job:${attempt.id}`, priority: 80, runAt: options.now(), payload: json({ ...payload, outboxId: outbox.id }), maxAttempts: PAYMENT_JOB_MAX_ATTEMPTS, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      const linked = await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { outboxId: outbox.id, jobId: job.id } });
      await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId, attemptId: attempt.id, type: "ATTEMPT_QUEUED", actorId: context.actorId, reason: `Cenário local ${input.scenario}.`, idempotencyKey: `payment-attempt-queued:${attempt.id}`, correlationId: attempt.correlationId, occurredAt: options.now(), safeMetadata: { scenario: input.scenario, amountCents: amount.toString(), externalEgress: false } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.attempt.queued_local", entityType: "PaymentAttempt", entityId: attempt.id, origin: "DOMAIN", changes: { invoiceId, scenario: input.scenario, amountCents: amount.toString(), externalEgress: false } } });
      return { attempt: linked, jobId: job.id, status: "QUEUED" as const, idempotent: false };
    }, { isolationLevel: "ReadCommitted" });
  }

  async function replayAttempt(context: AuthenticatedContext, invoiceId: string, attemptId: string, reason: string) {
    const attempt = await options.database.paymentAttempt.findFirst({ where: { id: attemptId, invoiceId, workspaceId: context.workspaceId } });
    const invoice = await options.database.invoice.findFirst({ where: { id: invoiceId, workspaceId: context.workspaceId } });
    if (!attempt || !invoice) fail("Tentativa não encontrada.", "PAYMENT_ATTEMPT_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_REPROCESS, resource(context, invoice.id, invoice.ownerMemberId));
    if (attempt.status !== "DEAD_LETTER") fail("Somente tentativa em falha terminal pode ser reprocessada.", "PAYMENT_REPLAY_NOT_ALLOWED");
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-replay:${context.workspaceId}:${attempt.id}`}, 0))`;
      const current = await tx.paymentAttempt.findFirstOrThrow({ where: { id: attempt.id, workspaceId: context.workspaceId } });
      if (current.status !== "DEAD_LETTER") return { attempt: current, idempotent: true };
      const actor = context.actorId;
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "PAYMENT_ATTEMPT", idempotencyKey: `payment-replay-job:${attempt.id}:${current.attempts + 1}`, priority: 90, runAt: options.now(), payload: { attemptId: attempt.id, invoiceId, scenario: attempt.scenario, outboxId: attempt.outboxId, externalEgress: false }, maxAttempts: PAYMENT_JOB_MAX_ATTEMPTS, createdByActorId: actor, updatedByActorId: actor } });
      const updated = await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "QUEUED", jobId: job.id, errorCode: null, errorMessage: null, failedAt: null } });
      await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId, attemptId: attempt.id, type: "REPLAY_REQUESTED", actorId: actor, reason, idempotencyKey: `payment-replay-requested:${job.id}`, correlationId: attempt.correlationId, occurredAt: options.now() });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: actor, action: "payment.attempt.replay_requested", entityType: "PaymentAttempt", entityId: attempt.id, origin: "API", changes: { reason, jobId: job.id, externalEgress: false } } });
      return { attempt: updated, jobId: job.id, idempotent: false };
    });
  }

  async function ingestSignedLocalWebhook(workspaceId: string, rawBody: Buffer, timestamp: string | null, signature: string | null) {
    if (rawBody.byteLength > PAYMENT_MAX_WEBHOOK_BYTES) fail("Webhook de pagamento excede 128 KiB.", "PAYMENT_WEBHOOK_TOO_LARGE", 413);
    const verified = verifyPaymentWebhook({ timestamp, signature, rawBody, now: options.now() });
    if (!verified.valid) fail("Assinatura ou timestamp do webhook local inválido.", `PAYMENT_WEBHOOK_${verified.reason}`, 401);
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody.toString("utf8")); } catch { fail("Payload JSON inválido.", "PAYMENT_WEBHOOK_INVALID_JSON", 400); }
    const event = paymentWebhookEventSchema.parse(decoded);
    const payloadHash = sha256(rawBody);
    const nonceHash = sha256(event.nonce);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-webhook:${workspaceId}:${event.eventId}`}, 0))`;
      const existing = await tx.paymentWebhookReceipt.findUnique({ where: { workspaceId_providerKey_providerEventId: { workspaceId, providerKey: PAYMENT_PROVIDER_KEY, providerEventId: event.eventId } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) fail("O eventId já existe com conteúdo diferente.", "PAYMENT_WEBHOOK_IDEMPOTENCY_CONFLICT");
        return { receiptId: existing.id, status: existing.status, idempotent: true, externalEgress: false as const };
      }
      const repeatedNonce = await tx.paymentWebhookReceipt.findUnique({ where: { workspaceId_providerKey_nonceHash: { workspaceId, providerKey: PAYMENT_PROVIDER_KEY, nonceHash } } });
      if (repeatedNonce) fail("Nonce de pagamento já utilizado.", "PAYMENT_WEBHOOK_REPLAY_REJECTED");
      const actor = await systemActor(tx, workspaceId);
      const receipt = await tx.paymentWebhookReceipt.create({ data: { workspaceId, providerKey: PAYMENT_PROVIDER_KEY, providerEventId: event.eventId, eventType: event.eventType, contractVersion: event.contractVersion, payloadHash, nonceHash, payloadSizeBytes: rawBody.byteLength, safePayload: json(event), signatureStatus: "VERIFIED", externalOccurredAt: new Date(event.occurredAt), receivedAt: options.now(), status: "RECEIVED", correlationId: event.eventId } });
      const job = await tx.job.create({ data: { workspaceId, type: "PAYMENT_WEBHOOK", idempotencyKey: `payment-webhook-job:${receipt.id}`, priority: 100, runAt: options.now(), payload: { receiptId: receipt.id, externalEgress: false }, maxAttempts: PAYMENT_JOB_MAX_ATTEMPTS, createdByActorId: actor.id, updatedByActorId: actor.id } });
      await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { jobId: job.id } });
      await tx.auditLog.create({ data: { workspaceId, actorId: actor.id, action: "payment.webhook.accepted_local", entityType: "PaymentWebhookReceipt", entityId: receipt.id, origin: "SYSTEM", requestId: event.eventId, changes: { eventType: event.eventType, payloadHash, externalEgress: false } } });
      return { receiptId: receipt.id, jobId: job.id, status: "RECEIVED" as const, idempotent: false, externalEgress: false as const };
    }, { isolationLevel: "ReadCommitted" });
  }

  async function resolveIssue(context: AuthenticatedContext, issueId: string, raw: unknown) {
    const input = reconciliationResolutionSchema.parse(raw);
    const issue = await options.database.paymentReconciliationIssue.findFirst({ where: { id: issueId, workspaceId: context.workspaceId } });
    if (!issue) fail("Divergência não encontrada.", "PAYMENT_RECONCILIATION_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_RECONCILE, resource(context, issue.id, issue.ownerMemberId));
    if (issue.status !== "OPEN") fail("A divergência já foi encerrada.", "PAYMENT_RECONCILIATION_ALREADY_RESOLVED");
    return options.database.$transaction(async (tx) => {
      let invoiceId = issue.invoiceId;
      let jobId: string | null = null;
      if (input.action === "LINK_AND_REPROCESS") {
        const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, workspaceId: context.workspaceId } });
        if (!invoice) fail("Cobrança de destino não encontrada.", "PAYMENT_INVOICE_NOT_FOUND", 404);
        await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, resource(context, invoice.id, invoice.ownerMemberId));
        await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_RECONCILE, resource(context, invoice.id, invoice.ownerMemberId));
        invoiceId = invoice.id;
        if (!issue.receiptId) fail("A divergência não possui receipt reprocessável.", "PAYMENT_RECEIPT_NOT_FOUND");
        const receipt = await tx.paymentWebhookReceipt.findFirstOrThrow({ where: { id: issue.receiptId, workspaceId: context.workspaceId } });
        const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "PAYMENT_WEBHOOK", idempotencyKey: `payment-reconcile-job:${issue.id}`, priority: 110, runAt: options.now(), payload: { receiptId: receipt.id, forcedInvoiceId: invoice.id, externalEgress: false }, maxAttempts: PAYMENT_JOB_MAX_ATTEMPTS, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        jobId = job.id;
        await tx.paymentWebhookReceipt.update({ where: { id: receipt.id }, data: { status: "RECEIVED", jobId: job.id, errorCode: null, errorMessage: null, nextRetryAt: null } });
      }
      const updated = await tx.paymentReconciliationIssue.update({ where: { id: issue.id }, data: { status: input.action === "DISMISS" ? "DISMISSED" : "RESOLVED", invoiceId, resolvedByActorId: context.actorId, resolutionReason: input.reason, resolvedAt: options.now() } });
      if (invoiceId) await appendPaymentEventInTransaction(tx, { workspaceId: context.workspaceId, invoiceId, type: "RECONCILIATION_RESOLVED", actorId: context.actorId, reason: input.reason, idempotencyKey: `payment-reconciliation-resolved:${issue.id}`, correlationId: issue.receiptId ?? issue.id, occurredAt: options.now(), safeMetadata: { action: input.action, jobId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.reconciliation.resolved", entityType: "PaymentReconciliationIssue", entityId: issue.id, origin: "API", changes: { action: input.action, invoiceId, reason: input.reason, jobId } } });
      return { issue: updated, jobId };
    });
  }

  return Object.freeze({ screen, detail, createInvoice, previewReceipt, recordReceipt, act, ingestSignedLocalWebhook, resolveIssue });
}

let service: ReturnType<typeof createPaymentService> | undefined;
export function getPaymentService() {
  service ??= createPaymentService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
