import { describe, expect, it } from "vitest";

import { checkoutCashSummary, checkoutEventTimeReason, classifyCheckoutEventReplay, reconcileCheckoutState, resolveCheckoutWebhookSecret, signCheckoutWebhook, transactionalCheckoutWebhookSchema, verifyCheckoutWebhook } from "@/modules/payments/domain/transactional-checkout-contracts";

describe("contrato do checkout transacional", () => {
  const event = { contractVersion: "1.0", workspaceId: "20000000-0000-4000-8000-000000000001", eventId: "evt:checkout:001", nonce: "nonce_checkout_0001", eventType: "PAYMENT_PENDING", providerSequence: 1, occurredAt: "2026-09-30T12:00:00.000Z", externalCheckoutId: "checkout:001", productId: "20000000-0000-4000-8000-000000000002", paymentMethod: "PIX", amountCents: 10_000, currency: "BRL" };

  it("valida o envelope sem aceitar produto ou valor ambíguo", () => {
    expect(transactionalCheckoutWebhookSchema.safeParse(event).success).toBe(true);
    expect(transactionalCheckoutWebhookSchema.safeParse({ ...event, productId: "outro" }).success).toBe(false);
    expect(transactionalCheckoutWebhookSchema.safeParse({ ...event, amountCents: 10.5 }).success).toBe(false);
  });

  it("exige segredo explícito em produção e valida HMAC/timestamp", () => {
    expect(() => resolveCheckoutWebhookSecret({ NODE_ENV: "production" })).toThrow("CHECKOUT_WEBHOOK_SECRET_REQUIRED");
    const environment = { NODE_ENV: "production", CHECKOUT_WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef" };
    const now = new Date(event.occurredAt);
    const rawBody = JSON.stringify(event);
    const signature = signCheckoutWebhook(now.toISOString(), rawBody, environment);
    expect(verifyCheckoutWebhook({ timestamp: now.toISOString(), signature, rawBody: Buffer.from(rawBody), now, environment })).toEqual({ valid: true });
    expect(verifyCheckoutWebhook({ timestamp: now.toISOString(), signature, rawBody: Buffer.from(`${rawBody} `), now, environment })).toEqual({ valid: false, reason: "INVALID" });
  });

  it("cobre pendência, expiração, recusa, compra, reembolso e assinatura", () => {
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PRE_CHECKOUT", subscriptionStatus: "NOT_APPLICABLE", eventType: "PAYMENT_PENDING" })).toMatchObject({ applicable: true, status: "PAYMENT_PENDING" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PAYMENT_PENDING", subscriptionStatus: "NOT_APPLICABLE", eventType: "PAYMENT_EXPIRED" })).toMatchObject({ applicable: true, status: "EXPIRED" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PAYMENT_PENDING", subscriptionStatus: "NOT_APPLICABLE", eventType: "PAYMENT_DECLINED" })).toMatchObject({ applicable: true, status: "DECLINED" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "DECLINED", subscriptionStatus: "NOT_APPLICABLE", eventType: "PURCHASE_CONFIRMED" })).toMatchObject({ applicable: true, status: "PURCHASED" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PURCHASED", subscriptionStatus: "NOT_APPLICABLE", eventType: "SUBSCRIPTION_ACTIVATED" })).toMatchObject({ applicable: true, subscriptionStatus: "ACTIVE" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PURCHASED", subscriptionStatus: "ACTIVE", eventType: "SUBSCRIPTION_PAST_DUE" })).toMatchObject({ applicable: true, subscriptionStatus: "PAST_DUE" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PURCHASED", subscriptionStatus: "PAST_DUE", eventType: "SUBSCRIPTION_CANCELLED" })).toMatchObject({ applicable: true, subscriptionStatus: "CANCELLED" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "PURCHASED", subscriptionStatus: "ACTIVE", eventType: "PURCHASE_REFUNDED" })).toMatchObject({ applicable: true, status: "REFUNDED" });
    expect(reconcileCheckoutState({ productKind: "PLAN", status: "REFUNDED", subscriptionStatus: "ACTIVE", eventType: "PURCHASE_REFUNDED" })).toEqual({ applicable: false, reason: "PURCHASE_REQUIRED" });
    expect(reconcileCheckoutState({ productKind: "PRODUCT", status: "PURCHASED", subscriptionStatus: "NOT_APPLICABLE", eventType: "SUBSCRIPTION_ACTIVATED" })).toEqual({ applicable: false, reason: "SUBSCRIPTION_NOT_APPLICABLE" });
  });

  it("expõe caixa líquido somente de compra e reembolso aplicados", () => {
    expect(checkoutCashSummary({ unitPriceCents: 10_000n, events: [{ type: "PURCHASE_CONFIRMED", applied: true }, { type: "PURCHASE_REFUNDED", applied: false }] })).toEqual({ grossCents: 10_000n, refundedCents: 0n, netCents: 10_000n });
    expect(checkoutCashSummary({ unitPriceCents: 10_000n, events: [{ type: "PURCHASE_CONFIRMED", applied: true }, { type: "PURCHASE_REFUNDED", applied: true }] })).toEqual({ grossCents: 10_000n, refundedCents: 10_000n, netCents: 0n });
  });

  it("rejeita eventId divergente e timestamp futuro", () => {
    expect(classifyCheckoutEventReplay({ payloadHash: "hash-a" }, "hash-a")).toBe("REPLAY");
    expect(classifyCheckoutEventReplay({ payloadHash: "hash-a" }, "hash-b")).toBe("CONFLICT");
    expect(checkoutEventTimeReason(new Date("2026-09-30T12:06:00Z"), new Date("2026-09-30T12:00:00Z"))).toBe("EVENT_IN_FUTURE");
  });
});
