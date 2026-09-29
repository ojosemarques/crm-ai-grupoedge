import type { PaymentSandboxScenario, PaymentWebhookEvent } from "@/modules/payments/domain/payment-contracts";
import { PAYMENT_CONTRACT_VERSION } from "@/modules/payments/domain/payment-contracts";

export class PaymentSandboxError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "PaymentSandboxError";
  }
}

export type PaymentSandboxCommand = Readonly<{
  attemptId: string;
  invoiceNumber: string;
  amountCents: bigint;
  scenario: PaymentSandboxScenario;
  attempt: number;
  now: Date;
}>;

export type PaymentSandboxResult = Readonly<{
  outcome: "ACCEPTED" | "DECLINED";
  externalAttemptId: string;
  callbacks: readonly PaymentWebhookEvent[];
  simulated: true;
  externalEgress: false;
}>;

export interface PaymentSandboxAdapter {
  readonly providerKey: "LOCAL_PAYMENT_SANDBOX";
  readonly externalEgress: false;
  submit(command: PaymentSandboxCommand): Promise<PaymentSandboxResult>;
}

export class LocalPaymentSandboxAdapter implements PaymentSandboxAdapter {
  readonly providerKey = "LOCAL_PAYMENT_SANDBOX" as const;
  readonly externalEgress = false as const;

  async submit(command: PaymentSandboxCommand): Promise<PaymentSandboxResult> {
    if (command.amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PaymentSandboxError("PAYMENT_SANDBOX_AMOUNT_TOO_LARGE", false);
    }
    if (command.scenario === "TIMEOUT") throw new PaymentSandboxError("PAYMENT_SANDBOX_TIMEOUT", true);
    if (command.scenario === "PERMANENT_FAILURE") throw new PaymentSandboxError("PAYMENT_SANDBOX_PERMANENT_FAILURE", false);

    const externalAttemptId = `local-attempt:${command.attemptId}`;
    if (command.scenario === "DECLINED") {
      return { outcome: "DECLINED", externalAttemptId, callbacks: [], simulated: true, externalEgress: false };
    }

    const unmatched = command.scenario === "UNMATCHED";
    const paymentId = `local-payment:${command.attemptId}`;
    const confirmation: PaymentWebhookEvent = {
      contractVersion: PAYMENT_CONTRACT_VERSION,
      eventId: `local-event:${command.attemptId}:payment_confirmed`,
      nonce: `confirm_${command.attemptId.replaceAll("-", "")}`,
      eventType: "PAYMENT_CONFIRMED",
      occurredAt: command.now.toISOString(),
      invoiceNumber: unmatched ? "INV-LOCAL-UNMATCHED" : command.invoiceNumber,
      externalAttemptId,
      externalPaymentId: paymentId,
      amountCents: Number(command.amountCents),
      currency: "BRL",
      reasonCode: null,
    };
    const chargeback: PaymentWebhookEvent = {
      ...confirmation,
      eventId: `local-event:${command.attemptId}:chargeback_recorded`,
      nonce: `chargeback_${command.attemptId.replaceAll("-", "")}`,
      eventType: "CHARGEBACK_RECORDED",
      occurredAt: new Date(command.now.getTime() + 1_000).toISOString(),
      reasonCode: "LOCAL_TEST_CHARGEBACK",
    };
    return {
      outcome: "ACCEPTED",
      externalAttemptId,
      callbacks: command.scenario === "CHARGEBACK" ? [confirmation, chargeback] : [confirmation],
      simulated: true,
      externalEgress: false,
    };
  }
}

export const localPaymentSandbox = new LocalPaymentSandboxAdapter();
