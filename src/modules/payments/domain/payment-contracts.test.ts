import { describe, expect, it } from "vitest";

import {
  canChargeInvoice,
  canIssueInvoice,
  invoiceStatusAfterPayment,
  invoiceTotalCents,
  outstandingCents,
  paymentWebhookEventSchema,
  signPaymentWebhook,
  verifyPaymentWebhook,
} from "@/modules/payments/domain/payment-contracts";
import { localPaymentSandbox, PaymentSandboxError } from "@/modules/payments/application/payment-sandbox-adapter";

describe("contratos de pagamentos", () => {
  it("mantém valores em centavos e estados finitos", () => {
    expect(invoiceTotalCents(10_000n, 500n)).toBe(9_500n);
    expect(() => invoiceTotalCents(100n, 101n)).toThrow("PAYMENT_INVALID_MONETARY_AMOUNT");
    expect(outstandingCents(10_000n, 2_000n)).toBe(8_000n);
    expect(invoiceStatusAfterPayment(10_000n, 0n)).toBe("OPEN");
    expect(invoiceStatusAfterPayment(10_000n, 1_000n)).toBe("PARTIALLY_PAID");
    expect(invoiceStatusAfterPayment(10_000n, 10_000n)).toBe("PAID");
    expect(canIssueInvoice("DRAFT")).toBe(true);
    expect(canChargeInvoice("PAID")).toBe(false);
  });

  it("valida assinatura, adulteração e expiração", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const rawBody = JSON.stringify({ eventId: "evt:payment:001" });
    const timestamp = now.toISOString();
    const environment = { NODE_ENV: "test", PAYMENT_SANDBOX_WEBHOOK_SECRET: "test-secret-only" };
    const signature = signPaymentWebhook(timestamp, rawBody, environment);
    expect(verifyPaymentWebhook({ timestamp, signature, rawBody: Buffer.from(rawBody), now, environment })).toEqual({ valid: true });
    expect(verifyPaymentWebhook({ timestamp, signature, rawBody: Buffer.from(`${rawBody} `), now, environment })).toEqual({ valid: false, reason: "INVALID" });
    expect(verifyPaymentWebhook({ timestamp: "2026-09-13T11:00:00.000Z", signature, rawBody: Buffer.from(rawBody), now, environment })).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("rejeita dinheiro fracionário e moeda diferente", () => {
    const base = {
      contractVersion: "1.0",
      eventId: "evt:payment:001",
      nonce: "nonce-payment-0001",
      eventType: "PAYMENT_CONFIRMED",
      occurredAt: "2026-09-13T12:00:00.000Z",
      invoiceNumber: "INV-2026-000001",
      externalPaymentId: "local-payment-001",
      amountCents: 10_000,
      currency: "BRL",
    };
    expect(paymentWebhookEventSchema.safeParse(base).success).toBe(true);
    expect(paymentWebhookEventSchema.safeParse({ ...base, amountCents: 10.5 }).success).toBe(false);
    expect(paymentWebhookEventSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  });
});

describe("sandbox local determinístico", () => {
  it("separa sucesso, recusa, timeout, falha permanente e chargeback sem egress", async () => {
    const base = { attemptId: "11111111-1111-4111-8111-111111111111", invoiceNumber: "INV-2049-000001", amountCents: 9900n, attempt: 1, now: new Date("2049-01-10T15:00:00.000Z") };
    await expect(localPaymentSandbox.submit({ ...base, scenario: "SUCCESS" })).resolves.toMatchObject({ outcome: "ACCEPTED", externalEgress: false, callbacks: [{ eventType: "PAYMENT_CONFIRMED" }] });
    await expect(localPaymentSandbox.submit({ ...base, scenario: "DECLINED" })).resolves.toMatchObject({ outcome: "DECLINED", callbacks: [], externalEgress: false });
    await expect(localPaymentSandbox.submit({ ...base, scenario: "CHARGEBACK" })).resolves.toMatchObject({ callbacks: [{ eventType: "PAYMENT_CONFIRMED" }, { eventType: "CHARGEBACK_RECORDED" }] });
    await expect(localPaymentSandbox.submit({ ...base, scenario: "TIMEOUT" })).rejects.toMatchObject({ code: "PAYMENT_SANDBOX_TIMEOUT", retryable: true } satisfies Partial<PaymentSandboxError>);
    await expect(localPaymentSandbox.submit({ ...base, scenario: "PERMANENT_FAILURE" })).rejects.toMatchObject({ code: "PAYMENT_SANDBOX_PERMANENT_FAILURE", retryable: false } satisfies Partial<PaymentSandboxError>);
  });
});
