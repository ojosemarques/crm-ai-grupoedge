import { describe, expect, it } from "vitest";
import { aggregateForecast, compareForecastItems, forecastEligibility, forecastFingerprint, percentageDelta } from "./forecast-contracts";

const base = { id: "a", status: "OPEN" as const, amountCents: 100_00n, currency: "BRL", expectedCloseAt: new Date("2026-09-15T12:00:00Z"), ownerMemberId: "m1", teamId: "t1", category: "PIPELINE" as const, probabilityBps: 5000, probabilitySource: "OPPORTUNITY_MANUAL", probabilityActorId: "actor", probabilityRecordedAt: new Date("2026-09-01T12:00:00Z") };
const cycle = { periodStart: new Date("2026-09-01T03:00:00Z"), periodEnd: new Date("2026-10-01T03:00:00Z"), currency: "BRL", scopeType: "TEAM", teamId: "t1" };

describe("forecast determinístico", () => {
  it("aplica elegibilidade por período, moeda, valor, status e escopo", () => {
    expect(forecastEligibility(base, cycle)).toEqual({ eligible: true, reasonCode: "ELIGIBLE" });
    expect(forecastEligibility({ ...base, amountCents: 0n }, cycle).reasonCode).toBe("MISSING_VALUE");
    expect(forecastEligibility({ ...base, expectedCloseAt: null }, cycle).reasonCode).toBe("MISSING_EXPECTED_CLOSE");
    expect(forecastEligibility({ ...base, currency: "USD" }, cycle).reasonCode).toBe("CURRENCY_MISMATCH");
    expect(forecastEligibility({ ...base, status: "WON" }, cycle).reasonCode).toBe("WON");
    expect(forecastEligibility({ ...base, teamId: "t2" }, cycle).reasonCode).toBe("OUTSIDE_SCOPE");
  });

  it("calcula pipeline cumulativo sem dupla contagem e weighted apenas com cobertura total", () => {
    const result = aggregateForecast([base, { ...base, id: "b", amountCents: 200_00n, category: "BEST_CASE" }, { ...base, id: "c", amountCents: 300_00n, category: "COMMIT" }]);
    expect(result).toMatchObject({ pipelineCents: 600_00n, bestCaseCents: 500_00n, commitCents: 300_00n, weightedPipelineCents: 300_00n, opportunityCount: 3, coverageState: "COMPLETE" });
    expect(aggregateForecast([{ ...base, probabilityActorId: null }])).toMatchObject({ weightedPipelineCents: null, coverageState: "PARTIAL", coverageBps: 0 });
    expect(aggregateForecast([])).toMatchObject({ weightedPipelineCents: null, coverageState: "NOT_AVAILABLE", opportunityCount: 0 });
  });

  it("gera hash estável e movimentos explicáveis entre cortes", () => {
    expect(forecastFingerprint({ b: 2, a: 1 })).toBe(forecastFingerprint({ a: 1, b: 2 }));
    const from = [{ opportunityId: "a", eligible: true, category: "PIPELINE" as const, amountCents: 100n, expectedCloseAt: new Date("2026-09-10Z"), ownerMemberId: "m1", teamId: "t1", status: "OPEN" as const, reasonCode: "ELIGIBLE" }];
    const to = [{ ...from[0]!, category: "COMMIT" as const, amountCents: 150n, ownerMemberId: "m2" }];
    expect(compareForecastItems(from, to).map((item) => item.type)).toEqual(["CATEGORY_ADVANCED", "VALUE_INCREASED", "OWNER_CHANGED"]);
    expect(percentageDelta(150n, 100n)).toBe(5000);
    expect(percentageDelta(0n, 0n)).toBeNull();
  });
});
