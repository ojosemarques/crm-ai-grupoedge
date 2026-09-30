import { describe, expect, it } from "vitest";
import {
  buildConsultativeRevenueIndicators,
  type ConsultativeRevenueFact,
} from "@/modules/revenue/domain/consultative-revenue-indicators";

const at = new Date("2026-09-30T12:00:00.000Z");

function fact(
  factId: string,
  semanticKey: string,
  kind: ConsultativeRevenueFact["kind"],
  amountCents: bigint,
  occurredAt = at,
  recordedAt = occurredAt,
  sequence = 1,
): ConsultativeRevenueFact {
  return {
    factId,
    semanticKey,
    kind,
    amountCents,
    currency: "BRL",
    occurredAt,
    recordedAt,
    sequence,
    source: kind === "OPPORTUNITY_WON"
      ? "OpportunityOutcomeSnapshot"
      : kind === "BOOKING_ACCEPTED"
        ? "ContractEvent+ContractVersion"
        : kind === "INVOICE_ISSUED"
          ? "PaymentEvent+Invoice"
          : "PaymentEvent+Payment",
    sourceEntityId: factId,
    correlationId: null,
  };
}

describe("indicadores da venda consultiva", () => {
  it("mantém ganho, bookings, fatura e pagamento como fatos independentes", () => {
    const result = buildConsultativeRevenueIndicators([
      fact("won-1", "opportunity:o1:won", "OPPORTUNITY_WON", 100_000n),
      fact("booking-1", "contract:c1:accepted", "BOOKING_ACCEPTED", 90_000n),
      fact("invoice-1", "invoice:i1:issued", "INVOICE_ISSUED", 30_000n),
      fact("payment-1", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 30_000n),
    ]);

    expect(result).toMatchObject({
      won: { count: 1, amountCents: "100000" },
      bookings: { count: 1, amountCents: "90000" },
      invoiced: { count: 1, amountCents: "30000" },
      payments: { count: 1, amountCents: "30000" },
      netCashCents: "30000",
    });
  });

  it("não duplica caixa com webhook repetido e compensa chargeback uma vez", () => {
    const result = buildConsultativeRevenueIndicators([
      fact("payment-first", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 30_000n),
      fact("payment-replay", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 30_000n),
      fact("chargeback-first", "payment:p1:compensation", "CHARGEBACK_RECORDED", 30_000n),
      fact("chargeback-replay", "payment:p1:compensation", "CHARGEBACK_RECORDED", 30_000n),
    ]);

    expect(result.payments).toEqual({ count: 1, amountCents: "30000" });
    expect(result.chargebacks).toEqual({ count: 1, amountCents: "30000" });
    expect(result.netCashCents).toBe("0");
    expect(result.duplicateCount).toBe(2);
    expect(result.divergences).toEqual([]);
  });

  it("isola divergência sem alterar o primeiro fato determinístico", () => {
    const result = buildConsultativeRevenueIndicators([
      fact("payment-first", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 30_000n, at, new Date("2026-09-30T12:00:01.000Z"), 1),
      fact("payment-divergent", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 31_000n, at, new Date("2026-09-30T12:00:02.000Z"), 2),
    ]);

    expect(result.payments.amountCents).toBe("30000");
    expect(result.netCashCents).toBe("30000");
    expect(result.divergences).toEqual([expect.objectContaining({
      semanticKey: "payment:p1:confirmed",
      acceptedFactId: "payment-first",
      conflictingFactId: "payment-divergent",
    })]);
  });

  it("é estável para eventos recebidos fora de ordem", () => {
    const earlier = new Date("2026-09-30T10:00:00.000Z");
    const later = new Date("2026-09-30T11:00:00.000Z");
    const unordered = [
      fact("chargeback", "payment:p1:compensation", "CHARGEBACK_RECORDED", 30_000n, later),
      fact("confirmed", "payment:p1:confirmed", "PAYMENT_CONFIRMED", 30_000n, earlier),
    ];

    const first = buildConsultativeRevenueIndicators(unordered);
    const second = buildConsultativeRevenueIndicators([...unordered].reverse());
    expect(first).toEqual(second);
    expect(first.netCashCents).toBe("0");
  });
});
