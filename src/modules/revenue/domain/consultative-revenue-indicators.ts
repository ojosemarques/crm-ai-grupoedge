export const consultativeRevenueFactKinds = [
  "OPPORTUNITY_WON",
  "BOOKING_ACCEPTED",
  "INVOICE_ISSUED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REVERSED",
  "CHARGEBACK_RECORDED",
] as const;

export type ConsultativeRevenueFactKind = (typeof consultativeRevenueFactKinds)[number];

export type ConsultativeRevenueFact = Readonly<{
  factId: string;
  semanticKey: string;
  kind: ConsultativeRevenueFactKind;
  amountCents: bigint;
  currency: "BRL";
  occurredAt: Date;
  recordedAt: Date;
  sequence: number;
  source: "OpportunityOutcomeSnapshot" | "ContractEvent+ContractVersion" | "PaymentEvent+Invoice" | "PaymentEvent+Payment";
  sourceEntityId: string;
  correlationId: string | null;
}>;

export type ConsultativeRevenueDivergence = Readonly<{
  semanticKey: string;
  acceptedFactId: string;
  conflictingFactId: string;
  acceptedAmountCents: string;
  conflictingAmountCents: string;
  acceptedKind: ConsultativeRevenueFactKind;
  conflictingKind: ConsultativeRevenueFactKind;
}>;

const kindOrder = new Map<ConsultativeRevenueFactKind, number>(
  consultativeRevenueFactKinds.map((kind, index) => [kind, index]),
);

function compareFacts(left: ConsultativeRevenueFact, right: ConsultativeRevenueFact) {
  return left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.recordedAt.getTime() - right.recordedAt.getTime()
    || left.sequence - right.sequence
    || (kindOrder.get(left.kind) ?? 0) - (kindOrder.get(right.kind) ?? 0)
    || left.factId.localeCompare(right.factId);
}

export function buildConsultativeRevenueIndicators(
  facts: readonly ConsultativeRevenueFact[],
) {
  const bySemanticKey = new Map<string, ConsultativeRevenueFact>();
  const accepted: ConsultativeRevenueFact[] = [];
  const divergences: ConsultativeRevenueDivergence[] = [];
  let duplicateCount = 0;

  for (const fact of [...facts].sort(compareFacts)) {
    if (fact.amountCents < 0n) {
      throw new Error(`O fato ${fact.factId} possui valor negativo.`);
    }
    const prior = bySemanticKey.get(fact.semanticKey);
    if (!prior) {
      bySemanticKey.set(fact.semanticKey, fact);
      accepted.push(fact);
      continue;
    }
    if (
      prior.amountCents === fact.amountCents
      && prior.currency === fact.currency
      && prior.kind === fact.kind
    ) {
      duplicateCount += 1;
      continue;
    }
    divergences.push({
      semanticKey: fact.semanticKey,
      acceptedFactId: prior.factId,
      conflictingFactId: fact.factId,
      acceptedAmountCents: prior.amountCents.toString(),
      conflictingAmountCents: fact.amountCents.toString(),
      acceptedKind: prior.kind,
      conflictingKind: fact.kind,
    });
  }

  const total = (kind: ConsultativeRevenueFactKind) => accepted
    .filter((fact) => fact.kind === kind)
    .reduce((sum, fact) => sum + fact.amountCents, 0n);
  const count = (kind: ConsultativeRevenueFactKind) => accepted
    .filter((fact) => fact.kind === kind).length;
  const confirmedCents = total("PAYMENT_CONFIRMED");
  const reversedCents = total("PAYMENT_REVERSED");
  const chargebackCents = total("CHARGEBACK_RECORDED");

  return Object.freeze({
    won: Object.freeze({ count: count("OPPORTUNITY_WON"), amountCents: total("OPPORTUNITY_WON").toString() }),
    bookings: Object.freeze({ count: count("BOOKING_ACCEPTED"), amountCents: total("BOOKING_ACCEPTED").toString() }),
    invoiced: Object.freeze({ count: count("INVOICE_ISSUED"), amountCents: total("INVOICE_ISSUED").toString() }),
    payments: Object.freeze({ count: count("PAYMENT_CONFIRMED"), amountCents: confirmedCents.toString() }),
    reversals: Object.freeze({ count: count("PAYMENT_REVERSED"), amountCents: reversedCents.toString() }),
    chargebacks: Object.freeze({ count: count("CHARGEBACK_RECORDED"), amountCents: chargebackCents.toString() }),
    netCashCents: (confirmedCents - reversedCents - chargebackCents).toString(),
    duplicateCount,
    divergences: Object.freeze(divergences),
    facts: Object.freeze(accepted.map((fact) => Object.freeze({
      factId: fact.factId,
      semanticKey: fact.semanticKey,
      kind: fact.kind,
      amountCents: fact.amountCents.toString(),
      currency: fact.currency,
      occurredAt: fact.occurredAt.toISOString(),
      recordedAt: fact.recordedAt.toISOString(),
      sequence: fact.sequence,
      source: fact.source,
      sourceEntityId: fact.sourceEntityId,
      correlationId: fact.correlationId,
    }))),
  });
}
