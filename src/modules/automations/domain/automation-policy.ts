import type { AutomationConditions } from "@/modules/automations/domain/automation-contracts";

function valueAtPath(payload: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function equals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchesAutomationConditions(
  payload: Readonly<Record<string, unknown>>,
  conditions: AutomationConditions,
): boolean {
  return conditions.all.every((condition) => {
    const actual = valueAtPath(payload, condition.path);
    if (condition.operator === "EXISTS") return actual !== undefined && actual !== null;
    if (condition.operator === "EQUALS") return equals(actual, condition.value);
    if (condition.operator === "NOT_EQUALS") return !equals(actual, condition.value);
    return Array.isArray(condition.value)
      ? condition.value.some((candidate) => equals(actual, candidate))
      : false;
  });
}

export function calculateBackoffSeconds(
  attemptNumber: number,
  baseSeconds: number,
  maximumSeconds = 3_600,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attemptNumber));
  const safeBase = Math.max(1, Math.trunc(baseSeconds));
  return Math.min(maximumSeconds, safeBase * 2 ** (safeAttempt - 1));
}
