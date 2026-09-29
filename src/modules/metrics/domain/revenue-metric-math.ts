import type { RevenueBridge, RevenueMetricDirection, RevenueMetricInterpretation, RevenueMetricState } from "@/modules/metrics/domain/revenue-metrics-contracts";

export type LedgerMovement = Readonly<{
  subscriptionId: string;
  accountId: string;
  type: "NEW" | "EXPANSION" | "CONTRACTION" | "RENEWAL" | "CHURN" | "REACTIVATION" | "REVERSAL";
  deltaMrrCents: bigint;
  effectiveAt: Date;
}>;

export function metricState(value: bigint | number | null, denominator: bigint | number | null = null): RevenueMetricState {
  if (denominator !== null && (denominator === 0 || denominator === 0n)) return "NO_DENOMINATOR";
  if (value === null) return "UNAVAILABLE";
  return value === 0 || value === 0n ? "ZERO" : "AVAILABLE";
}

export function divideBasisPoints(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number((numerator * 10_000n + denominator / 2n) / denominator);
}

export function balanceAt(movements: readonly LedgerMovement[], at: Date): bigint {
  return movements.reduce((sum, movement) => movement.effectiveAt < at ? sum + movement.deltaMrrCents : sum, 0n);
}

export function buildRevenueBridge(movements: readonly LedgerMovement[], from: Date, to: Date, asOf: Date): RevenueBridge {
  const cut = asOf < to ? asOf : to;
  const opening = balanceAt(movements, from);
  let newMrr = 0n;
  let expansion = 0n;
  let reactivation = 0n;
  let contraction = 0n;
  let churn = 0n;
  let adjustments = 0n;
  for (const movement of movements) {
    if (movement.effectiveAt < from || movement.effectiveAt >= cut) continue;
    if (movement.type === "NEW" && movement.deltaMrrCents >= 0n) newMrr += movement.deltaMrrCents;
    else if (movement.type === "EXPANSION" && movement.deltaMrrCents >= 0n) expansion += movement.deltaMrrCents;
    else if (movement.type === "REACTIVATION" && movement.deltaMrrCents >= 0n) reactivation += movement.deltaMrrCents;
    else if (movement.type === "CONTRACTION" && movement.deltaMrrCents <= 0n) contraction += -movement.deltaMrrCents;
    else if (movement.type === "CHURN" && movement.deltaMrrCents <= 0n) churn += -movement.deltaMrrCents;
    else adjustments += movement.deltaMrrCents;
  }
  const closing = balanceAt(movements, cut);
  const netNew = newMrr + expansion + reactivation - contraction - churn + adjustments;
  return Object.freeze({ openingMrrCents: opening.toString(), newMrrCents: newMrr.toString(), expansionMrrCents: expansion.toString(), reactivationMrrCents: reactivation.toString(), contractionMrrCents: contraction.toString(), churnMrrCents: churn.toString(), adjustmentsCents: adjustments.toString(), netNewMrrCents: netNew.toString(), closingMrrCents: closing.toString(), reconciled: opening + netNew === closing });
}

export function cohortRetention(movements: readonly LedgerMovement[], from: Date, to: Date, asOf: Date) {
  const before = new Map<string, bigint>();
  for (const movement of movements) if (movement.effectiveAt < from) before.set(movement.subscriptionId, (before.get(movement.subscriptionId) ?? 0n) + movement.deltaMrrCents);
  const cohort = new Set([...before].filter(([, balance]) => balance > 0n).map(([id]) => id));
  const initial = [...before].filter(([id]) => cohort.has(id)).reduce((sum, [, value]) => sum + value, 0n);
  const cut = asOf < to ? asOf : to;
  const cohortMovements = movements.filter((movement) => cohort.has(movement.subscriptionId) && movement.effectiveAt >= from && movement.effectiveAt < cut);
  const contraction = cohortMovements.filter((item) => item.type === "CONTRACTION" && item.deltaMrrCents < 0n).reduce((sum, item) => sum - item.deltaMrrCents, 0n);
  const churn = cohortMovements.filter((item) => item.type === "CHURN" && item.deltaMrrCents < 0n).reduce((sum, item) => sum - item.deltaMrrCents, 0n);
  const final = initial + cohortMovements.reduce((sum, item) => sum + item.deltaMrrCents, 0n);
  return Object.freeze({ subscriptionIds: Object.freeze([...cohort].sort()), initialMrrCents: initial, finalMrrCents: final, grrBasisPoints: divideBasisPoints(initial > contraction + churn ? initial - contraction - churn : 0n, initial), nrrBasisPoints: divideBasisPoints(final > 0n ? final : 0n, initial) });
}

export function compareValues(current: bigint | number | null, previous: bigint | number | null, desired: "UP" | "DOWN" | "CONTEXT") {
  if (current === null || previous === null) return { absolute: null, percentageBasisPoints: null, direction: "NOT_COMPARABLE" as RevenueMetricDirection, interpretation: "NOT_ENOUGH_DATA" as RevenueMetricInterpretation };
  const currentBig = typeof current === "bigint" ? current : BigInt(current);
  const previousBig = typeof previous === "bigint" ? previous : BigInt(previous);
  const absolute = currentBig - previousBig;
  const direction: RevenueMetricDirection = absolute === 0n ? "STABLE" : absolute > 0n ? "UP" : "DOWN";
  const percentageBasisPoints = previousBig === 0n ? null : Number((absolute * 10_000n) / (previousBig < 0n ? -previousBig : previousBig));
  const interpretation: RevenueMetricInterpretation = direction === "STABLE" ? "NEUTRAL" : desired === "CONTEXT" ? "CONTEXT_REQUIRED" : (direction === desired ? "POSITIVE" : "NEGATIVE");
  return { absolute, percentageBasisPoints, direction, interpretation };
}
