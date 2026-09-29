import { describe, expect, it } from "vitest";
import { goalPeriodInstants, goalProgress, quotaTargetKey, resolveEffectiveQuota } from "./goal-contracts";

describe("CRM-55 goal contracts", () => {
  it("converte período civil inclusivo em intervalo UTC exclusivo no timezone", () => {
    const range = goalPeriodInstants("2026-09-01", "2026-09-30", "America/Sao_Paulo");
    expect(range.start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
  it("aplica precedência membro, equipe, função sem somar quotas", () => {
    const base = { metricKey: "OPPORTUNITIES_WON" };
    const quotas = [
      { ...base, targetType: "FUNCTION" as const, memberId: null, teamId: null, function: "CLOSER" },
      { ...base, targetType: "TEAM" as const, memberId: null, teamId: "team", function: null },
      { ...base, targetType: "MEMBER" as const, memberId: "member", teamId: null, function: null },
    ];
    expect(resolveEffectiveQuota(quotas, { memberId: "member", teamIds: ["team"], functions: ["CLOSER"] })?.targetType).toBe("MEMBER");
    expect(resolveEffectiveQuota(quotas.slice(0, 2), { memberId: "member", teamIds: ["team"], functions: ["CLOSER"] })?.targetType).toBe("TEAM");
  });
  it("distingue zero, ausência de denominador e alvo zero", () => {
    expect(goalProgress(0n, 10n)).toEqual({ actualValue: "0", attainmentBps: 0, state: "ZERO" });
    expect(goalProgress(null, 10n, "NO_DENOMINATOR").state).toBe("NO_DENOMINATOR");
    expect(goalProgress(0n, 0n).state).toBe("NOT_APPLICABLE");
    expect(quotaTargetKey({ targetType: "FUNCTION", memberId: null, teamId: null, function: "SDR" })).toBe("FUNCTION:SDR");
  });
});
