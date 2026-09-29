import type { AttributionCreditResult, AttributionTouchpointInput } from "@/modules/marketing/domain/marketing-contracts";

export const ATTRIBUTION_POLICY_VERSION = "crm38-attribution-v1";

export function calculateAttributionCredits(
  algorithm: "FIRST_TOUCH" | "LAST_TOUCH" | "LINEAR",
  touchpoints: readonly AttributionTouchpointInput[],
): readonly AttributionCreditResult[] {
  const ordered = [...touchpoints].sort((a, b) =>
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
  const eligible = ordered.filter((touchpoint) => touchpoint.eligible);
  if (eligible.length === 0) {
    return [{
      touchpointId: null,
      creditBps: 10_000,
      coverageState: "UNATTRIBUTED",
      reasonCode: "NO_ELIGIBLE_EVIDENCE",
      explanation: "Sem touchpoint elegível no período; 100% permanece explicitamente não atribuído.",
    }];
  }

  const coverageState = eligible.length === ordered.length ? "COMPLETE" : "PARTIAL";
  const reasonCode = coverageState === "COMPLETE" ? "ELIGIBLE_EVIDENCE_COMPLETE" : "INELIGIBLE_EVIDENCE_EXCLUDED";
  const selected = algorithm === "FIRST_TOUCH"
    ? [eligible[0]!]
    : algorithm === "LAST_TOUCH"
      ? [eligible[eligible.length - 1]!]
      : eligible;
  const base = Math.floor(10_000 / selected.length);
  const remainder = 10_000 - base * selected.length;

  return selected.map((touchpoint, index) => ({
    touchpointId: touchpoint.id,
    creditBps: base + (index < remainder ? 1 : 0),
    coverageState,
    reasonCode,
    explanation:
      algorithm === "FIRST_TOUCH"
        ? "Crédito integral ao primeiro touchpoint elegível."
        : algorithm === "LAST_TOUCH"
          ? "Crédito integral ao último touchpoint elegível."
          : `Crédito linear determinístico entre ${selected.length} touchpoints elegíveis.`,
  }));
}

export function assertExactCreditTotal(credits: readonly Pick<AttributionCreditResult, "creditBps">[]): void {
  const total = credits.reduce((sum, credit) => sum + credit.creditBps, 0);
  if (total !== 10_000) throw new Error(`Créditos inválidos: esperado 10000 bps, recebido ${total}.`);
}
