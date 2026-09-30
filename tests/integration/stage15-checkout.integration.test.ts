import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createTransactionalCheckoutService } from "@/modules/payments/application/transactional-checkout-service";
import { CHECKOUT_CONTRACT_VERSION, signCheckoutWebhook } from "@/modules/payments/domain/transactional-checkout-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for stage 15 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 15 requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const clock = new Date("2050-01-15T15:00:00.000Z");
let workspaceId: string;
let closer: AuthenticatedContext;
let otherCloser: AuthenticatedContext;
let productId: string;
let planId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [closer, otherCloser] = await Promise.all([context("closer1@demo.politizai.local"), context("closer2@demo.politizai.local")]);
  const base = { workspaceId, audience: "INDIVIDUAL" as const, availability: "AVAILABLE" as const, revenueCategory: "SOFTWARE" as const, salesGateProfile: "STANDARD" as const, listPriceCents: 19_900n, currency: "BRL" as const, active: true, createdByActorId: closer.actorId, updatedByActorId: closer.actorId };
  const [product, plan] = await Promise.all([
    database.product.create({ data: { ...base, sku: "STAGE15-INDIVIDUAL", name: "Produto individual transacional", kind: "PRODUCT" } }),
    database.product.create({ data: { ...base, sku: "STAGE15-PLAN", name: "Plano individual recorrente", kind: "PLAN" } }),
  ]);
  productId = product.id;
  planId = plan.id;
});

afterAll(async () => database.$disconnect());

const service = () => createTransactionalCheckoutService({ database, now: () => clock });

function webhook(input: { checkout: { externalCheckoutId: string; productId: string }; eventId: string; nonce: string; eventType: string; providerSequence: number }) {
  const body = JSON.stringify({ contractVersion: CHECKOUT_CONTRACT_VERSION, workspaceId, eventId: input.eventId, nonce: input.nonce, eventType: input.eventType, providerSequence: input.providerSequence, occurredAt: new Date(clock.getTime() + input.providerSequence * 1_000).toISOString(), externalCheckoutId: input.checkout.externalCheckoutId, productId: input.checkout.productId, paymentMethod: "PIX", amountCents: 19_900, currency: "BRL" });
  const timestamp = clock.toISOString();
  return { rawBody: Buffer.from(body), timestamp, signature: signCheckoutWebhook(timestamp, body, { NODE_ENV: "test" }) };
}

describe("etapa 15 — checkout transacional e caixa", () => {
  it("restringe produto e checkout ao dono sem transformar oferta consultiva em carrinho", async () => {
    const institutional = await database.product.findFirstOrThrow({ where: { workspaceId, audience: "INSTITUTIONAL", active: true, deletedAt: null } });
    await expect(service().create(closer, { productId: institutional.id, paymentMethod: "PIX", sourceType: "CRM", idempotencyKey: "stage15:consultative:blocked" })).rejects.toMatchObject({ code: "CHECKOUT_AUDIENCE_NOT_INDIVIDUAL" });

    const created = await service().create(closer, { productId, paymentMethod: "PIX", sourceType: "LANDING_PAGE", sourceId: "lp-stage15", sourceMetadata: { utmSource: "integration" }, idempotencyKey: "stage15:create:owner" });
    await expect(service().detail(otherCloser, created.checkout.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service().act(otherCloser, created.checkout.id, { action: "ABANDON", expectedRevision: 1, reason: "Outro dono não pode alterar." })).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await service().list(otherCloser)).some((row) => row.id === created.checkout.id)).toBe(false);
    await expect(service().create(otherCloser, { productId, paymentMethod: "PIX", sourceType: "LANDING_PAGE", sourceId: "lp-stage15", sourceMetadata: { utmSource: "integration" }, idempotencyKey: "stage15:create:owner" })).rejects.toMatchObject({ code: "CHECKOUT_IDEMPOTENCY_CONFLICT" });
    await expect(service().create(closer, { productId, paymentMethod: "PIX", sourceType: "LANDING_PAGE", sourceId: "lp-stage15", sourceMetadata: { utmSource: "different" }, idempotencyKey: "stage15:create:owner" })).rejects.toMatchObject({ code: "CHECKOUT_IDEMPOTENCY_CONFLICT" });
  });

  it("reconcilia compra e reembolso uma vez sem fabricar pagamento ou MRR consultivo", async () => {
    const created = await service().create(closer, { productId, paymentMethod: "PIX", sourceType: "API", sourceId: "order-stage15", idempotencyKey: "stage15:create:cash" });
    const checkout = { externalCheckoutId: created.checkout.externalCheckoutId, productId };
    const paymentsBefore = await database.payment.count({ where: { workspaceId } });
    const movementsBefore = await database.revenueMovement.count({ where: { workspaceId } });

    const purchase = webhook({ checkout, eventId: "stage15.purchase.001", nonce: "stage15_purchase_nonce_001", eventType: "PURCHASE_CONFIRMED", providerSequence: 1 });
    await expect(service().ingestSignedWebhook(purchase.rawBody, purchase.timestamp, purchase.signature)).resolves.toMatchObject({ applied: true, status: "PURCHASED", idempotent: false });
    await expect(service().ingestSignedWebhook(purchase.rawBody, purchase.timestamp, purchase.signature)).resolves.toMatchObject({ applied: true, idempotent: true });
    await expect(service().detail(closer, created.checkout.id)).resolves.toMatchObject({ cash: { grossCents: 19_900n, refundedCents: 0n, netCents: 19_900n } });

    const refund = webhook({ checkout, eventId: "stage15.refund.001", nonce: "stage15_refund_nonce_0001", eventType: "PURCHASE_REFUNDED", providerSequence: 2 });
    await expect(service().ingestSignedWebhook(refund.rawBody, refund.timestamp, refund.signature)).resolves.toMatchObject({ applied: true, status: "REFUNDED", idempotent: false });
    await expect(service().ingestSignedWebhook(refund.rawBody, refund.timestamp, refund.signature)).resolves.toMatchObject({ applied: true, idempotent: true });
    await expect(service().detail(closer, created.checkout.id)).resolves.toMatchObject({ cash: { grossCents: 19_900n, refundedCents: 19_900n, netCents: 0n } });
    expect(await database.transactionalCheckoutEvent.count({ where: { workspaceId, checkoutId: created.checkout.id, providerEventId: { not: null } } })).toBe(2);
    expect(await database.payment.count({ where: { workspaceId } })).toBe(paymentsBefore);
    expect(await database.revenueMovement.count({ where: { workspaceId } })).toBe(movementsBefore);
  });

  it("preserva ordem, produto e semântica recorrente do provedor", async () => {
    const oneOff = await service().create(closer, { productId, paymentMethod: "PIX", sourceType: "API", idempotencyKey: "stage15:create:one-off" });
    const checkout = { externalCheckoutId: oneOff.checkout.externalCheckoutId, productId };
    const purchase = webhook({ checkout, eventId: "stage15.purchase.002", nonce: "stage15_purchase_nonce_002", eventType: "PURCHASE_CONFIRMED", providerSequence: 1 });
    await service().ingestSignedWebhook(purchase.rawBody, purchase.timestamp, purchase.signature);
    const subscription = webhook({ checkout, eventId: "stage15.subscription.001", nonce: "stage15_subscription_001", eventType: "SUBSCRIPTION_ACTIVATED", providerSequence: 2 });
    await expect(service().ingestSignedWebhook(subscription.rawBody, subscription.timestamp, subscription.signature)).resolves.toMatchObject({ applied: false, ignoredReason: "SUBSCRIPTION_NOT_APPLICABLE" });
    const late = webhook({ checkout, eventId: "stage15.late.001", nonce: "stage15_late_nonce_000001", eventType: "PAYMENT_PENDING", providerSequence: 1 });
    await expect(service().ingestSignedWebhook(late.rawBody, late.timestamp, late.signature)).resolves.toMatchObject({ applied: false, ignoredReason: "OUT_OF_ORDER" });

    const plan = await service().create(closer, { productId: planId, paymentMethod: "PIX", sourceType: "API", idempotencyKey: "stage15:create:plan" });
    const planCheckout = { externalCheckoutId: plan.checkout.externalCheckoutId, productId: planId };
    const planPurchase = webhook({ checkout: planCheckout, eventId: "stage15.plan.purchase", nonce: "stage15_plan_purchase_01", eventType: "PURCHASE_CONFIRMED", providerSequence: 1 });
    await service().ingestSignedWebhook(planPurchase.rawBody, planPurchase.timestamp, planPurchase.signature);
    const activated = webhook({ checkout: planCheckout, eventId: "stage15.plan.active", nonce: "stage15_plan_active_0001", eventType: "SUBSCRIPTION_ACTIVATED", providerSequence: 2 });
    await expect(service().ingestSignedWebhook(activated.rawBody, activated.timestamp, activated.signature)).resolves.toMatchObject({ applied: true, subscriptionStatus: "ACTIVE" });
  });
});
