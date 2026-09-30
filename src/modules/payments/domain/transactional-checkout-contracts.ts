import { z } from "zod";

import type { CatalogItemKind } from "@/generated/prisma/client";

import { signLocalWebhook, verifyLocalWebhookSignature } from "@/modules/integrations/domain/integration-policy";

export const CHECKOUT_PROVIDER_KEY = "POLITIZAI_SIGNED_CHECKOUT_V1";
export const CHECKOUT_CONTRACT_VERSION = "1.0";
export const CHECKOUT_MAX_WEBHOOK_BYTES = 128 * 1024;
export const CHECKOUT_WEBHOOK_TOLERANCE_SECONDS = 300;
const CHECKOUT_LOCAL_TEST_SECRET = "politizai-checkout-local-test-only-not-a-secret";

export const checkoutEventTypes = [
  "PAYMENT_PENDING",
  "PAYMENT_EXPIRED",
  "PAYMENT_DECLINED",
  "PURCHASE_CONFIRMED",
  "PURCHASE_REFUNDED",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_PAST_DUE",
  "SUBSCRIPTION_CANCELLED",
] as const;

export type CheckoutEventType = (typeof checkoutEventTypes)[number];
export type CheckoutStatus = "PRE_CHECKOUT" | "PAYMENT_PENDING" | "ABANDONED" | "EXPIRED" | "DECLINED" | "PURCHASED" | "REFUNDED";
export type CheckoutSubscriptionStatus = "NOT_APPLICABLE" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

const sourceMetadataSchema = z.object({
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  referrer: z.string().url().max(2_000).optional(),
}).strict();

export const createTransactionalCheckoutSchema = z.object({
  productId: z.string().uuid(),
  paymentMethod: z.enum(["PIX", "BOLETO"]),
  sourceType: z.enum(["CRM", "LANDING_PAGE", "FORM", "API"]),
  sourceId: z.string().trim().min(1).max(180).optional(),
  sourceMetadata: sourceMetadataSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(180),
}).strict();

export const transactionalCheckoutActionSchema = z.object({
  action: z.literal("ABANDON"),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const transactionalCheckoutWebhookSchema = z.object({
  contractVersion: z.literal(CHECKOUT_CONTRACT_VERSION),
  workspaceId: z.string().uuid(),
  eventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,180}$/),
  nonce: z.string().trim().regex(/^[A-Za-z0-9_-]{16,180}$/),
  eventType: z.enum(checkoutEventTypes),
  providerSequence: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  externalCheckoutId: z.string().trim().min(8).max(180),
  productId: z.string().uuid(),
  paymentMethod: z.enum(["PIX", "BOLETO"]),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("BRL"),
  reasonCode: z.string().trim().min(2).max(100).nullable().optional(),
}).strict();

export type TransactionalCheckoutWebhook = z.infer<typeof transactionalCheckoutWebhookSchema>;

export function resolveCheckoutWebhookSecret(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = environment.CHECKOUT_WEBHOOK_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (environment.NODE_ENV === "production") throw new Error("CHECKOUT_WEBHOOK_SECRET_REQUIRED");
  return CHECKOUT_LOCAL_TEST_SECRET;
}

export function signCheckoutWebhook(timestamp: string, rawBody: string, environment?: Readonly<Record<string, string | undefined>>): string {
  return signLocalWebhook(resolveCheckoutWebhookSecret(environment), timestamp, rawBody);
}

export function verifyCheckoutWebhook(input: Readonly<{ timestamp: string | null; signature: string | null; rawBody: Buffer; now: Date; environment?: Readonly<Record<string, string | undefined>> }>): Readonly<{ valid: true } | { valid: false; reason: "MISSING_SIGNATURE" | "INVALID" | "EXPIRED" }> {
  if (!input.timestamp || !input.signature) return { valid: false, reason: "MISSING_SIGNATURE" };
  const status = verifyLocalWebhookSignature({ secret: resolveCheckoutWebhookSecret(input.environment), timestamp: input.timestamp, signature: input.signature, rawBody: input.rawBody.toString("utf8"), now: input.now, toleranceSeconds: CHECKOUT_WEBHOOK_TOLERANCE_SECONDS });
  return status === "VERIFIED" ? { valid: true } : { valid: false, reason: status };
}

export function checkoutEventTimeReason(occurredAt: Date, now: Date): "EVENT_IN_FUTURE" | null {
  return occurredAt.getTime() > now.getTime() + CHECKOUT_WEBHOOK_TOLERANCE_SECONDS * 1_000 ? "EVENT_IN_FUTURE" : null;
}

export function classifyCheckoutEventReplay(existing: Readonly<{ payloadHash: string }> | null, payloadHash: string): "NEW" | "REPLAY" | "CONFLICT" {
  if (!existing) return "NEW";
  return existing.payloadHash === payloadHash ? "REPLAY" : "CONFLICT";
}

export function checkoutCashSummary(input: Readonly<{ unitPriceCents: bigint; events: ReadonlyArray<Readonly<{ type: string; applied: boolean }>> }>) {
  const purchased = input.events.some((event) => event.applied && event.type === "PURCHASE_CONFIRMED");
  const refunded = input.events.some((event) => event.applied && event.type === "PURCHASE_REFUNDED");
  const grossCents = purchased ? input.unitPriceCents : 0n;
  const refundedCents = refunded ? input.unitPriceCents : 0n;
  return { grossCents, refundedCents, netCents: grossCents - refundedCents };
}

export function reconcileCheckoutState(input: Readonly<{ status: CheckoutStatus; subscriptionStatus: CheckoutSubscriptionStatus; eventType: CheckoutEventType; productKind: CatalogItemKind }>): Readonly<{ applicable: true; status: CheckoutStatus; subscriptionStatus: CheckoutSubscriptionStatus } | { applicable: false; reason: string }> {
  const { status, subscriptionStatus, eventType } = input;
  if (eventType.startsWith("SUBSCRIPTION_") && input.productKind !== "PLAN") return { applicable: false, reason: "SUBSCRIPTION_NOT_APPLICABLE" };
  if (eventType === "PAYMENT_PENDING") {
    return status === "PRE_CHECKOUT" ? { applicable: true, status: "PAYMENT_PENDING", subscriptionStatus } : { applicable: false, reason: "INVALID_STATE_TRANSITION" };
  }
  if (eventType === "PAYMENT_EXPIRED") {
    return ["PRE_CHECKOUT", "PAYMENT_PENDING"].includes(status) ? { applicable: true, status: "EXPIRED", subscriptionStatus } : { applicable: false, reason: "INVALID_STATE_TRANSITION" };
  }
  if (eventType === "PAYMENT_DECLINED") {
    return ["PRE_CHECKOUT", "PAYMENT_PENDING"].includes(status) ? { applicable: true, status: "DECLINED", subscriptionStatus } : { applicable: false, reason: "INVALID_STATE_TRANSITION" };
  }
  if (eventType === "PURCHASE_CONFIRMED") {
    return status !== "PURCHASED" && status !== "REFUNDED" ? { applicable: true, status: "PURCHASED", subscriptionStatus } : { applicable: false, reason: "INVALID_STATE_TRANSITION" };
  }
  if (eventType === "PURCHASE_REFUNDED") {
    return status === "PURCHASED" ? { applicable: true, status: "REFUNDED", subscriptionStatus } : { applicable: false, reason: "PURCHASE_REQUIRED" };
  }
  if (eventType === "SUBSCRIPTION_ACTIVATED") {
    return status === "PURCHASED" && subscriptionStatus === "NOT_APPLICABLE" ? { applicable: true, status, subscriptionStatus: "ACTIVE" } : { applicable: false, reason: "PURCHASE_REQUIRED" };
  }
  if (eventType === "SUBSCRIPTION_PAST_DUE") {
    return status === "PURCHASED" && subscriptionStatus === "ACTIVE" ? { applicable: true, status, subscriptionStatus: "PAST_DUE" } : { applicable: false, reason: "ACTIVE_SUBSCRIPTION_REQUIRED" };
  }
  return ["PURCHASED", "REFUNDED"].includes(status) && ["ACTIVE", "PAST_DUE"].includes(subscriptionStatus)
    ? { applicable: true, status, subscriptionStatus: "CANCELLED" }
    : { applicable: false, reason: "ACTIVE_SUBSCRIPTION_REQUIRED" };
}
