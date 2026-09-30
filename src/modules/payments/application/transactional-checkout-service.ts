import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { transactionalCatalogEligibilityReason } from "@/modules/catalog/domain/catalog-sellability-policy";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import {
  CHECKOUT_MAX_WEBHOOK_BYTES,
  CHECKOUT_PROVIDER_KEY,
  checkoutCashSummary,
  checkoutEventTimeReason,
  classifyCheckoutEventReplay,
  createTransactionalCheckoutSchema,
  reconcileCheckoutState,
  transactionalCheckoutActionSchema,
  transactionalCheckoutWebhookSchema,
  verifyCheckoutWebhook,
} from "@/modules/payments/domain/transactional-checkout-contracts";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resource(context: Pick<AuthenticatedContext, "workspaceId">, id?: string, ownerMemberId?: string): ResourceScope {
  return { workspaceId: context.workspaceId, resourceType: "Payment", resourceId: id ?? context.workspaceId, ...(ownerMemberId ? { ownerMemberId } : {}) };
}

async function systemActor(tx: Tx, workspaceId: string) {
  const actor = await tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM", userId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!actor) fail("Ator Sistema não configurado.", "CHECKOUT_SYSTEM_ACTOR_MISSING");
  return actor;
}

export function createTransactionalCheckoutService(options: Options) {
  const authorization = createAuthorizationService({ database: options.database });

  async function list(context: AuthenticatedContext) {
    const rows = await options.database.transactionalCheckout.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100 });
    const visible = [];
    for (const checkout of rows) if ((await authorization.authorize(context, PermissionKeys.PAYMENTS_READ, resource(context, checkout.id, checkout.ownerMemberId))).allowed) visible.push(checkout);
    if (!visible.length) await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, resource(context, undefined, context.memberId));
    const events = visible.length ? await options.database.transactionalCheckoutEvent.findMany({ where: { workspaceId: context.workspaceId, checkoutId: { in: visible.map((row) => row.id) }, applied: true, type: { in: ["PURCHASE_CONFIRMED", "PURCHASE_REFUNDED"] } }, select: { checkoutId: true, type: true, applied: true } }) : [];
    return visible.map((checkout) => ({ ...checkout, cash: checkoutCashSummary({ unitPriceCents: checkout.unitPriceCentsSnapshot, events: events.filter((event) => event.checkoutId === checkout.id) }) }));
  }

  async function detail(context: AuthenticatedContext, checkoutId: string) {
    const checkout = await options.database.transactionalCheckout.findFirst({ where: { workspaceId: context.workspaceId, id: checkoutId } });
    if (!checkout) fail("Checkout não encontrado.", "CHECKOUT_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, resource(context, checkout.id, checkout.ownerMemberId));
    const events = await options.database.transactionalCheckoutEvent.findMany({ where: { workspaceId: context.workspaceId, checkoutId }, orderBy: [{ sequence: "asc" }, { id: "asc" }] });
    return { checkout, events, cash: checkoutCashSummary({ unitPriceCents: checkout.unitPriceCentsSnapshot, events }) };
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    const input = createTransactionalCheckoutSchema.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, undefined, context.memberId));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transactional-checkout-create:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const replay = await tx.transactionalCheckout.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.ownerMemberId !== context.memberId) fail("A chave de idempotência pertence a outro responsável.", "CHECKOUT_IDEMPOTENCY_CONFLICT");
        const sourceChanged = canonicalJson(replay.sourceMetadata ?? {}) !== canonicalJson(input.sourceMetadata ?? {});
        if (replay.productId !== input.productId || replay.paymentMethod !== input.paymentMethod || replay.sourceType !== input.sourceType || replay.sourceId !== (input.sourceId ?? null) || sourceChanged) fail("A chave de idempotência já foi usada com outro checkout.", "CHECKOUT_IDEMPOTENCY_CONFLICT");
        return { checkout: replay, idempotent: true };
      }
      const product = await tx.product.findFirst({ where: { workspaceId: context.workspaceId, id: input.productId, deletedAt: null } });
      if (!product) fail("Produto não encontrado.", "CHECKOUT_PRODUCT_NOT_FOUND", 404);
      const ineligible = transactionalCatalogEligibilityReason(product, options.now());
      if (ineligible) fail("Produto não elegível para checkout transacional.", `CHECKOUT_${ineligible}`, 422);
      const id = randomUUID();
      const checkout = await tx.transactionalCheckout.create({ data: {
        id,
        workspaceId: context.workspaceId,
        productId: product.id,
        ownerMemberId: context.memberId,
        productCatalogItemIdSnapshot: product.catalogItemId,
        productVersionSnapshot: product.version,
        productSkuSnapshot: product.sku,
        productNameSnapshot: product.name,
        productKindSnapshot: product.kind,
        unitPriceCentsSnapshot: product.listPriceCents,
        currency: product.currency,
        paymentMethod: input.paymentMethod,
        providerKey: CHECKOUT_PROVIDER_KEY,
        externalCheckoutId: `pscv1_${id.replaceAll("-", "")}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        sourceMetadata: input.sourceMetadata ? json(input.sourceMetadata) : Prisma.JsonNull,
        idempotencyKey: input.idempotencyKey,
        createdByActorId: context.actorId,
      } });
      const payloadHash = sha256(canonicalJson(input));
      await tx.transactionalCheckoutEvent.create({ data: { workspaceId: context.workspaceId, checkoutId: checkout.id, sequence: 1, type: "PRE_CHECKOUT_CREATED", previousStatus: null, newStatus: "PRE_CHECKOUT", previousSubscriptionStatus: null, newSubscriptionStatus: "NOT_APPLICABLE", providerKey: CHECKOUT_PROVIDER_KEY, payloadHash, idempotencyKey: `checkout-created:${checkout.id}`, occurredAt: checkout.createdAt, safeMetadata: json({ sourceType: checkout.sourceType, sourceId: checkout.sourceId, productId: checkout.productId, paymentMethod: checkout.paymentMethod }), actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "checkout.transactional.created", entityType: "TransactionalCheckout", entityId: checkout.id, origin: "API", changes: { productId: checkout.productId, productVersion: checkout.productVersionSnapshot, sourceType: checkout.sourceType, paymentMethod: checkout.paymentMethod, providerKey: checkout.providerKey } } });
      return { checkout, idempotent: false };
    }, { isolationLevel: "ReadCommitted" });
  }

  async function act(context: AuthenticatedContext, checkoutId: string, raw: unknown) {
    const input = transactionalCheckoutActionSchema.parse(raw);
    const candidate = await options.database.transactionalCheckout.findFirst({ where: { workspaceId: context.workspaceId, id: checkoutId } });
    if (!candidate) fail("Checkout não encontrado.", "CHECKOUT_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_MANAGE, resource(context, candidate.id, candidate.ownerMemberId));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transactional-checkout:${context.workspaceId}:${checkoutId}`}, 0))`;
      const checkout = await tx.transactionalCheckout.findFirst({ where: { workspaceId: context.workspaceId, id: checkoutId } });
      if (!checkout) fail("Checkout não encontrado.", "CHECKOUT_NOT_FOUND", 404);
      if (checkout.revision !== input.expectedRevision) fail("O checkout foi alterado; atualize a página.", "CHECKOUT_VERSION_CONFLICT");
      if (! ["PRE_CHECKOUT", "PAYMENT_PENDING"].includes(checkout.status)) fail("Checkout não pode mais ser abandonado.", "CHECKOUT_INVALID_STATE_TRANSITION");
      const now = options.now();
      const updated = await tx.transactionalCheckout.update({ where: { id: checkout.id }, data: { status: "ABANDONED", abandonedAt: now, revision: { increment: 1 } } });
      const last = await tx.transactionalCheckoutEvent.findFirst({ where: { workspaceId: context.workspaceId, checkoutId }, orderBy: [{ sequence: "desc" }, { id: "desc" }] });
      await tx.transactionalCheckoutEvent.create({ data: { workspaceId: context.workspaceId, checkoutId, sequence: (last?.sequence ?? 0) + 1, type: "CHECKOUT_ABANDONED", previousStatus: checkout.status, newStatus: "ABANDONED", previousSubscriptionStatus: checkout.subscriptionStatus, newSubscriptionStatus: checkout.subscriptionStatus, providerKey: CHECKOUT_PROVIDER_KEY, payloadHash: sha256(canonicalJson(input)), idempotencyKey: `checkout-abandoned:${checkout.id}:r${updated.revision}`, occurredAt: now, safeMetadata: json({ reason: input.reason }), actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "checkout.transactional.abandoned", entityType: "TransactionalCheckout", entityId: checkout.id, origin: "API", reason: input.reason, changes: { previousStatus: checkout.status, newStatus: "ABANDONED" } } });
      return updated;
    });
  }

  async function ingestSignedWebhook(rawBody: Buffer, timestamp: string | null, signature: string | null) {
    if (rawBody.byteLength > CHECKOUT_MAX_WEBHOOK_BYTES) fail("Webhook de checkout excede 128 KiB.", "CHECKOUT_WEBHOOK_TOO_LARGE", 413);
    const verified = verifyCheckoutWebhook({ timestamp, signature, rawBody, now: options.now() });
    if (!verified.valid) fail("Assinatura ou timestamp do webhook de checkout inválido.", `CHECKOUT_WEBHOOK_${verified.reason}`, 401);
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody.toString("utf8")); } catch { fail("Payload JSON inválido.", "CHECKOUT_WEBHOOK_INVALID_JSON", 400); }
    const event = transactionalCheckoutWebhookSchema.parse(decoded);
    const payloadHash = sha256(rawBody);
    const nonceHash = sha256(event.nonce);
    const occurredAt = new Date(event.occurredAt);
    const timeReason = checkoutEventTimeReason(occurredAt, options.now());
    if (timeReason) fail("Evento de checkout possui horário futuro inválido.", `CHECKOUT_${timeReason}`, 422);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transactional-checkout-webhook:${event.workspaceId}:${event.externalCheckoutId}`}, 0))`;
      const prior = await tx.transactionalCheckoutEvent.findUnique({ where: { workspaceId_providerKey_providerEventId: { workspaceId: event.workspaceId, providerKey: CHECKOUT_PROVIDER_KEY, providerEventId: event.eventId } } });
      const replayClassification = classifyCheckoutEventReplay(prior, payloadHash);
      if (replayClassification === "CONFLICT") fail("O eventId já existe com conteúdo diferente.", "CHECKOUT_WEBHOOK_IDEMPOTENCY_CONFLICT");
      if (prior) {
        return { checkoutId: prior.checkoutId, eventId: prior.id, applied: prior.applied, ignoredReason: prior.ignoredReason, idempotent: true };
      }
      const replayedNonce = await tx.transactionalCheckoutEvent.findUnique({ where: { workspaceId_providerKey_nonceHash: { workspaceId: event.workspaceId, providerKey: CHECKOUT_PROVIDER_KEY, nonceHash } } });
      if (replayedNonce) fail("Nonce de checkout já utilizado.", "CHECKOUT_WEBHOOK_REPLAY_REJECTED");
      const checkout = await tx.transactionalCheckout.findFirst({ where: { workspaceId: event.workspaceId, providerKey: CHECKOUT_PROVIDER_KEY, externalCheckoutId: event.externalCheckoutId } });
      if (!checkout) fail("Checkout externo não encontrado.", "CHECKOUT_NOT_FOUND", 404);
      const actor = await systemActor(tx, event.workspaceId);
      if (checkout.productId !== event.productId || checkout.paymentMethod !== event.paymentMethod || checkout.unitPriceCentsSnapshot !== BigInt(event.amountCents) || checkout.currency !== event.currency) {
        fail("Evento não corresponde ao produto e às condições do checkout.", "CHECKOUT_PROVIDER_REFERENCE_MISMATCH", 422);
      }
      const last = await tx.transactionalCheckoutEvent.findFirst({ where: { workspaceId: event.workspaceId, checkoutId: checkout.id }, orderBy: [{ sequence: "desc" }, { id: "desc" }] });
      const sequence = (last?.sequence ?? 0) + 1;
      const outOfOrder = event.providerSequence <= checkout.lastAppliedProviderSequence;
      const reconciled = outOfOrder
        ? { applicable: false as const, reason: "OUT_OF_ORDER" }
        : reconcileCheckoutState({ status: checkout.status, subscriptionStatus: checkout.subscriptionStatus, eventType: event.eventType, productKind: checkout.productKindSnapshot });
      const eventRow = await tx.transactionalCheckoutEvent.create({ data: {
        workspaceId: event.workspaceId,
        checkoutId: checkout.id,
        sequence,
        type: event.eventType,
        previousStatus: checkout.status,
        newStatus: reconciled.applicable ? reconciled.status : checkout.status,
        previousSubscriptionStatus: checkout.subscriptionStatus,
        newSubscriptionStatus: reconciled.applicable ? reconciled.subscriptionStatus : checkout.subscriptionStatus,
        providerKey: CHECKOUT_PROVIDER_KEY,
        providerEventId: event.eventId,
        providerSequence: event.providerSequence,
        payloadHash,
        nonceHash,
        idempotencyKey: `checkout-provider-event:${event.eventId}`,
        occurredAt,
        applied: reconciled.applicable,
        ignoredReason: reconciled.applicable ? null : reconciled.reason,
        safeMetadata: json({ reasonCode: event.reasonCode ?? null, externalCheckoutId: event.externalCheckoutId, providerSequence: event.providerSequence, paymentMethod: event.paymentMethod, amountCents: event.amountCents, currency: event.currency }),
        actorId: actor.id,
      } });
      if (!reconciled.applicable) {
        await tx.auditLog.create({ data: { workspaceId: event.workspaceId, actorId: actor.id, action: "checkout.transactional.event_ignored", entityType: "TransactionalCheckout", entityId: checkout.id, origin: "SYSTEM", requestId: event.eventId, changes: { eventType: event.eventType, reason: reconciled.reason, occurredAt: event.occurredAt } } });
        return { checkoutId: checkout.id, eventId: eventRow.id, applied: false, ignoredReason: reconciled.reason, idempotent: false };
      }
      const update = await tx.transactionalCheckout.update({ where: { id: checkout.id }, data: {
        status: reconciled.status,
        subscriptionStatus: reconciled.subscriptionStatus,
        lastAppliedProviderOccurredAt: occurredAt,
        lastAppliedProviderEventId: event.eventId,
        lastAppliedProviderSequence: event.providerSequence,
        revision: { increment: 1 },
        ...(event.eventType === "PAYMENT_EXPIRED" ? { expiresAt: occurredAt } : {}),
        ...(event.eventType === "PURCHASE_CONFIRMED" ? { purchasedAt: occurredAt } : {}),
        ...(event.eventType === "PURCHASE_REFUNDED" ? { refundedAt: occurredAt } : {}),
      } });
      await tx.auditLog.create({ data: { workspaceId: event.workspaceId, actorId: actor.id, action: `checkout.transactional.${event.eventType.toLowerCase()}`, entityType: "TransactionalCheckout", entityId: checkout.id, origin: "SYSTEM", requestId: event.eventId, changes: { previousStatus: checkout.status, newStatus: update.status, previousSubscriptionStatus: checkout.subscriptionStatus, newSubscriptionStatus: update.subscriptionStatus, providerKey: CHECKOUT_PROVIDER_KEY } } });
      return { checkoutId: checkout.id, eventId: eventRow.id, applied: true, status: update.status, subscriptionStatus: update.subscriptionStatus, idempotent: false };
    }, { isolationLevel: "ReadCommitted" });
  }

  return Object.freeze({ list, detail, create, act, ingestSignedWebhook });
}

let service: ReturnType<typeof createTransactionalCheckoutService> | undefined;
export function getTransactionalCheckoutService() {
  service ??= createTransactionalCheckoutService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
