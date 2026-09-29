import { describe, expect, it } from "vitest";
import { assertExactCreditTotal, calculateAttributionCredits } from "@/modules/marketing/domain/attribution-policy";

const touchpoints = [
  { id: "b", occurredAt: new Date("2026-01-02T00:00:00Z"), eligible: true, evidenceClass: "DIRECT" as const },
  { id: "a", occurredAt: new Date("2026-01-01T00:00:00Z"), eligible: true, evidenceClass: "DERIVED" as const },
  { id: "c", occurredAt: new Date("2026-01-03T00:00:00Z"), eligible: false, evidenceClass: "LEGACY_REVIEW_REQUIRED" as const },
];

describe("calculateAttributionCredits", () => {
  it.each([
    ["FIRST_TOUCH", "a"],
    ["LAST_TOUCH", "b"],
  ] as const)("aplica %s de forma determinística", (algorithm, expected) => {
    const credits = calculateAttributionCredits(algorithm, touchpoints);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ touchpointId: expected, creditBps: 10_000, coverageState: "PARTIAL" });
    expect(() => assertExactCreditTotal(credits)).not.toThrow();
  });

  it("distribui linearmente com soma exata de 10.000 bps", () => {
    const credits = calculateAttributionCredits("LINEAR", touchpoints);
    expect(credits.map((credit) => credit.creditBps)).toEqual([5_000, 5_000]);
    expect(() => assertExactCreditTotal(credits)).not.toThrow();
  });

  it("mantém conversão explicitamente não atribuída sem evidência elegível", () => {
    const credits = calculateAttributionCredits("LAST_TOUCH", touchpoints.map((item) => ({ ...item, eligible: false })));
    expect(credits).toEqual([{ touchpointId: null, creditBps: 10_000, coverageState: "UNATTRIBUTED", reasonCode: "NO_ELIGIBLE_EVIDENCE", explanation: expect.any(String) }]);
  });
});
