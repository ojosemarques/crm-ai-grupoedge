export type SloResult = Readonly<{
  total: number;
  good: number;
  complianceBasisPoints: number | null;
  targetBasisPoints: number;
  errorBudgetBasisPoints: number;
  consumedBudgetBasisPoints: number | null;
  burnRate: number | null;
  state: "NO_DATA" | "HEALTHY" | "AT_RISK" | "BREACHED";
}>;

export function calculateSlo(input: Readonly<{ good: number; total: number; targetBasisPoints: number }>): SloResult {
  if (!Number.isInteger(input.good) || !Number.isInteger(input.total) || input.good < 0 || input.total < 0 || input.good > input.total) throw new Error("INVALID_SLO_SAMPLE");
  if (!Number.isInteger(input.targetBasisPoints) || input.targetBasisPoints <= 0 || input.targetBasisPoints >= 10_000) throw new Error("INVALID_SLO_TARGET");
  const errorBudget = 10_000 - input.targetBasisPoints;
  if (input.total === 0) return { total: 0, good: 0, complianceBasisPoints: null, targetBasisPoints: input.targetBasisPoints, errorBudgetBasisPoints: errorBudget, consumedBudgetBasisPoints: null, burnRate: null, state: "NO_DATA" };
  const compliance = Math.round((input.good / input.total) * 10_000);
  const failureBps = 10_000 - compliance;
  const burnRate = failureBps / errorBudget;
  return { total: input.total, good: input.good, complianceBasisPoints: compliance, targetBasisPoints: input.targetBasisPoints, errorBudgetBasisPoints: errorBudget, consumedBudgetBasisPoints: failureBps, burnRate, state: compliance >= input.targetBasisPoints ? "HEALTHY" : burnRate >= 2 ? "BREACHED" : "AT_RISK" };
}
