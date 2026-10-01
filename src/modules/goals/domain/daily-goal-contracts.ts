import { z } from "zod";

export const dailyGoalMetricKeys = [
  "CALLS",
  "MESSAGES",
  "EFFECTIVE_CONTACTS",
  "QUALIFICATIONS",
  "MEETINGS_SCHEDULED",
  "PROPOSALS",
  "SALES_VALUE_CENTS",
] as const;

export type DailyGoalMetricKey = (typeof dailyGoalMetricKeys)[number];

export const dailyGoalInputSchema = z.object({
  memberId: z.string().uuid(),
  expectedRevision: z.number().int().positive().nullable().default(null),
  callsTarget: z.number().int().min(0).max(100_000),
  messagesTarget: z.number().int().min(0).max(100_000),
  effectiveContactsTarget: z.number().int().min(0).max(100_000),
  qualificationsTarget: z.number().int().min(0).max(100_000),
  meetingsScheduledTarget: z.number().int().min(0).max(100_000),
  proposalsTarget: z.number().int().min(0).max(100_000),
  salesValueTargetCents: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ]).transform(BigInt).refine((value) => value <= 100_000_000_000_000n, "O valor diário informado é muito alto."),
}).strict();

export type DailyGoalTargets = Readonly<{
  calls: bigint;
  messages: bigint;
  effectiveContacts: bigint;
  qualifications: bigint;
  meetingsScheduled: bigint;
  proposals: bigint;
  salesValueCents: bigint;
}>;

export type DailyGoalActuals = DailyGoalTargets;

const metricDefinitions = [
  { key: "CALLS", label: "Ligações", unit: "COUNT", actual: "calls", target: "calls" },
  { key: "MESSAGES", label: "Mensagens", unit: "COUNT", actual: "messages", target: "messages" },
  { key: "EFFECTIVE_CONTACTS", label: "Contatos efetivos", unit: "COUNT", actual: "effectiveContacts", target: "effectiveContacts" },
  { key: "QUALIFICATIONS", label: "Qualificações", unit: "COUNT", actual: "qualifications", target: "qualifications" },
  { key: "MEETINGS_SCHEDULED", label: "Reuniões marcadas", unit: "COUNT", actual: "meetingsScheduled", target: "meetingsScheduled" },
  { key: "PROPOSALS", label: "Propostas", unit: "COUNT", actual: "proposals", target: "proposals" },
  { key: "SALES_VALUE_CENTS", label: "Valor vendido", unit: "CURRENCY_CENTS", actual: "salesValueCents", target: "salesValueCents" },
] as const;

export function buildDailyGoalProgress(actuals: DailyGoalActuals, targets: DailyGoalTargets) {
  const metrics = metricDefinitions.map((definition) => {
    const actual = actuals[definition.actual];
    const target = targets[definition.target];
    const remaining = target > actual ? target - actual : 0n;
    const progressPercent = target === 0n ? null : Math.min(100, Number((actual * 10_000n) / target) / 100);
    return Object.freeze({
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      actualValue: actual.toString(),
      targetValue: target.toString(),
      remainingValue: remaining.toString(),
      progressPercent,
      achieved: target > 0n && actual >= target,
    });
  });
  const active = metrics.filter((metric) => BigInt(metric.targetValue) > 0n);
  const completed = active.filter((metric) => metric.achieved).length;
  const progressPercent = active.length === 0
    ? 0
    : Math.round(active.reduce((total, metric) => total + (metric.progressPercent ?? 0), 0) / active.length);
  return Object.freeze({
    completed,
    target: active.length,
    remaining: Math.max(0, active.length - completed),
    progressPercent,
    metrics: Object.freeze(metrics),
  });
}
