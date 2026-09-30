import { z } from "zod";

import { signLocalWebhook, verifyLocalWebhookSignature } from "@/modules/integrations/domain/integration-policy";

export const PAYMENT_PROVIDER_KEY = "LOCAL_PAYMENT_SANDBOX";
export const PAYMENT_CONTRACT_VERSION = "1.0";
export const PAYMENT_MAX_WEBHOOK_BYTES = 128 * 1024;
export const PAYMENT_WEBHOOK_TOLERANCE_SECONDS = 300;
export const PAYMENT_JOB_MAX_ATTEMPTS = 3;
export const PAYMENT_LOCAL_TEST_SECRET = "politizai-payment-local-test-only-not-a-secret";

export const paymentSandboxScenarios = [
  "SUCCESS",
  "DECLINED",
  "TIMEOUT",
  "PERMANENT_FAILURE",
  "CHARGEBACK",
  "UNMATCHED",
] as const;

export type PaymentSandboxScenario = (typeof paymentSandboxScenarios)[number];

export const createInvoiceSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    billingPeriodStart: z.coerce.date(),
    billingPeriodEnd: z.coerce.date(),
    dueAt: z.coerce.date(),
    description: z.string().trim().min(3).max(240).optional(),
    upfrontCents: z.coerce.bigint().nonnegative().max(BigInt(Number.MAX_SAFE_INTEGER)).default(0n),
    idempotencyKey: z.string().trim().min(8).max(180),
  })
  .superRefine((value, context) => {
    if (value.billingPeriodEnd <= value.billingPeriodStart) {
      context.addIssue({ code: "custom", path: ["billingPeriodEnd"], message: "O fim da competência deve ser posterior ao início." });
    }
    if (value.dueAt < value.billingPeriodStart) {
      context.addIssue({ code: "custom", path: ["dueAt"], message: "O vencimento não pode anteceder a competência." });
    }
  });

export const invoiceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ISSUE"), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
  z.object({
    action: z.literal("CHARGE"),
    expectedRevision: z.number().int().positive(),
    scenario: z.enum(paymentSandboxScenarios),
    idempotencyKey: z.string().trim().min(8).max(180),
  }),
  z.object({ action: z.literal("VOID"), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("REPLAY"), attemptId: z.string().uuid(), reason: z.string().trim().min(8).max(500) }),
]);

export const paymentWebhookEventSchema = z
  .object({
    contractVersion: z.literal(PAYMENT_CONTRACT_VERSION),
    eventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,180}$/),
    nonce: z.string().trim().regex(/^[A-Za-z0-9_-]{16,180}$/),
    eventType: z.enum(["PAYMENT_CONFIRMED", "PAYMENT_REVERSED", "CHARGEBACK_RECORDED"]),
    occurredAt: z.string().datetime({ offset: true }),
    invoiceNumber: z.string().trim().min(3).max(80),
    externalAttemptId: z.string().trim().min(3).max(180).nullable().optional(),
    externalPaymentId: z.string().trim().min(3).max(180),
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal("BRL"),
    reasonCode: z.string().trim().min(2).max(100).nullable().optional(),
  })
  .strict();

export type PaymentWebhookEvent = z.infer<typeof paymentWebhookEventSchema>;

export const reconciliationResolutionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("LINK_AND_REPROCESS"), invoiceId: z.string().uuid(), reason: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("DISMISS"), reason: z.string().trim().min(8).max(500) }),
]);

export const paymentBackfillSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]).default("DRY_RUN"),
  idempotencyKey: z.string().trim().min(8).max(180),
});

export function invoiceTotalCents(subtotalCents: bigint, discountCents: bigint): bigint {
  if (subtotalCents < 0n || discountCents < 0n || discountCents > subtotalCents) {
    throw new Error("PAYMENT_INVALID_MONETARY_AMOUNT");
  }
  return subtotalCents - discountCents;
}

export function outstandingCents(totalCents: bigint, paidCents: bigint): bigint {
  const outstanding = totalCents - paidCents;
  return outstanding > 0n ? outstanding : 0n;
}

export function invoiceStatusAfterPayment(totalCents: bigint, paidCents: bigint): "OPEN" | "PARTIALLY_PAID" | "PAID" {
  if (paidCents <= 0n) return "OPEN";
  if (paidCents < totalCents) return "PARTIALLY_PAID";
  return "PAID";
}

export function canIssueInvoice(status: string): boolean {
  return status === "DRAFT";
}

export function canChargeInvoice(status: string): boolean {
  return status === "OPEN" || status === "PARTIALLY_PAID";
}

export function resolvePaymentSandboxSecret(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  if (environment.NODE_ENV === "production") throw new Error("PAYMENT_SANDBOX_DISABLED_IN_PRODUCTION");
  return environment.PAYMENT_SANDBOX_WEBHOOK_SECRET?.trim() || PAYMENT_LOCAL_TEST_SECRET;
}

export function signPaymentWebhook(timestamp: string, rawBody: string, environment?: Readonly<Record<string, string | undefined>>): string {
  return signLocalWebhook(resolvePaymentSandboxSecret(environment), timestamp, rawBody);
}

export function verifyPaymentWebhook(input: Readonly<{
  timestamp: string | null;
  signature: string | null;
  rawBody: Buffer;
  now: Date;
  environment?: Readonly<Record<string, string | undefined>>;
}>): Readonly<{ valid: true } | { valid: false; reason: "MISSING_SIGNATURE" | "INVALID" | "EXPIRED" }> {
  if (!input.timestamp || !input.signature) return { valid: false, reason: "MISSING_SIGNATURE" };
  const status = verifyLocalWebhookSignature({
    secret: resolvePaymentSandboxSecret(input.environment),
    timestamp: input.timestamp,
    signature: input.signature,
    rawBody: input.rawBody.toString("utf8"),
    now: input.now,
    toleranceSeconds: PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
  });
  return status === "VERIFIED" ? { valid: true } : { valid: false, reason: status };
}
