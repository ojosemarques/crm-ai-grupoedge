import { describe, expect, it } from "vitest";
import { aggregateCampaignReturns, buildRevenueBridge, cohortRetention, compareValues, divideBasisPoints, metricState, type LedgerMovement } from "./revenue-metric-math";

const day = (value: number) => new Date(`2026-08-${String(value).padStart(2, "0")}T12:00:00.000Z`);
const movements: LedgerMovement[] = [
  { subscriptionId: "a", accountId: "one", type: "NEW", deltaMrrCents: 10_000n, effectiveAt: day(1) },
  { subscriptionId: "a", accountId: "one", type: "EXPANSION", deltaMrrCents: 2_000n, effectiveAt: day(11) },
  { subscriptionId: "a", accountId: "one", type: "CONTRACTION", deltaMrrCents: -1_000n, effectiveAt: day(12) },
  { subscriptionId: "b", accountId: "two", type: "NEW", deltaMrrCents: 3_000n, effectiveAt: day(13) },
  { subscriptionId: "a", accountId: "one", type: "REVERSAL", deltaMrrCents: 500n, effectiveAt: day(14) },
];

describe("métricas canônicas de receita", () => {
  it("reconcilia a ponte e não conta movimentos após o corte", () => {
    const bridge = buildRevenueBridge(movements, day(10), day(20), day(15));
    expect(bridge).toMatchObject({ openingMrrCents: "10000", newMrrCents: "3000", expansionMrrCents: "2000", contractionMrrCents: "1000", adjustmentsCents: "500", netNewMrrCents: "4500", closingMrrCents: "14500", reconciled: true });
  });

  it("calcula GRR e NRR apenas sobre a coorte ativa inicial", () => {
    const result = cohortRetention(movements, day(10), day(20), day(20));
    expect(result.subscriptionIds).toEqual(["a"]);
    expect(result.grrBasisPoints).toBe(9000);
    expect(result.nrrBasisPoints).toBe(11_500);
  });

  it("diferencia zero, ausência de denominador e indisponibilidade", () => {
    expect(metricState(0)).toBe("ZERO");
    expect(metricState(0n)).toBe("ZERO");
    expect(metricState(null)).toBe("UNAVAILABLE");
    expect(metricState(0, 0)).toBe("NO_DENOMINATOR");
    expect(divideBasisPoints(1n, 0n)).toBeNull();
  });

  it("interpreta subida de SLA/custo como direção desfavorável", () => {
    expect(compareValues(120, 60, "DOWN")).toMatchObject({ direction: "UP", interpretation: "NEGATIVE", percentageBasisPoints: 10_000 });
    expect(compareValues(0, 0, "UP")).toMatchObject({ direction: "STABLE", percentageBasisPoints: null });
  });

  it("reúne investimento e receita atribuída por campanha sem misturar campanhas", () => {
    expect(aggregateCampaignReturns(
      [{ campaignId: "a", spendCents: 10_000n }, { campaignId: "a", spendCents: 5_000n }, { campaignId: "b", spendCents: 20_000n }, { campaignId: null, spendCents: 99_000n }],
      [{ campaignId: "a", attributedRevenueCents: 45_000n }, { campaignId: "b", attributedRevenueCents: 10_000n }, { campaignId: "c", attributedRevenueCents: 5_000n }],
    )).toEqual([
      { campaignId: "a", spendCents: 15_000n, attributedRevenueCents: 45_000n, returnBasisPoints: 30_000 },
      { campaignId: "b", spendCents: 20_000n, attributedRevenueCents: 10_000n, returnBasisPoints: 5_000 },
      { campaignId: "c", spendCents: 0n, attributedRevenueCents: 5_000n, returnBasisPoints: null },
    ]);
  });
});
