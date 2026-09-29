import { z } from "zod";
import { addLocalDays, parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";

export const goalMetricKeys = ["LEADS_ASSIGNED", "HUMAN_ATTEMPTS", "MEETINGS_HELD", "OPPORTUNITIES_WON", "REVENUE_WON_CENTS", "NEW_MRR_CENTS", "EXPANSION_MRR_CENTS", "RENEWALS_COMPLETED", "LEAD_TO_SALE_BPS"] as const;
export const goalFunctions = ["MARKETING", "SDR", "CLOSER", "CUSTOMER_SUCCESS", "FARMER", "FINANCE", "REVOPS"] as const;
export const goalMetricUnits = {
  LEADS_ASSIGNED: "COUNT", HUMAN_ATTEMPTS: "COUNT", MEETINGS_HELD: "COUNT", OPPORTUNITIES_WON: "COUNT",
  REVENUE_WON_CENTS: "CURRENCY_CENTS", NEW_MRR_CENTS: "CURRENCY_CENTS", EXPANSION_MRR_CENTS: "CURRENCY_CENTS",
  RENEWALS_COMPLETED: "COUNT", LEAD_TO_SALE_BPS: "BASIS_POINTS",
} as const;

export const goalMetricCatalog = [
  { key: "LEADS_ASSIGNED", label: "Leads recebidos", unit: "COUNT", fact: "leads.createdAt", direction: "HIGHER_IS_BETTER" },
  { key: "HUMAN_ATTEMPTS", label: "Tentativas humanas", unit: "COUNT", fact: "activities.occurredAt", direction: "HIGHER_IS_BETTER" },
  { key: "MEETINGS_HELD", label: "Reuniões realizadas", unit: "COUNT", fact: "meetings.completedAt", direction: "HIGHER_IS_BETTER" },
  { key: "OPPORTUNITIES_WON", label: "Vendas", unit: "COUNT", fact: "opportunities.closedAt", direction: "HIGHER_IS_BETTER" },
  { key: "REVENUE_WON_CENTS", label: "Receita ganha", unit: "CURRENCY_CENTS", fact: "opportunities.amountCents", direction: "HIGHER_IS_BETTER" },
  { key: "NEW_MRR_CENTS", label: "Novo MRR", unit: "CURRENCY_CENTS", fact: "opportunities.mrrCents", direction: "HIGHER_IS_BETTER" },
  { key: "EXPANSION_MRR_CENTS", label: "MRR de expansão", unit: "CURRENCY_CENTS", fact: "revenue_movements.deltaMrrCents", direction: "HIGHER_IS_BETTER" },
  { key: "RENEWALS_COMPLETED", label: "Renovações decididas", unit: "COUNT", fact: "renewals.decidedAt", direction: "HIGHER_IS_BETTER" },
  { key: "LEAD_TO_SALE_BPS", label: "Conversão lead → venda", unit: "BASIS_POINTS", fact: "opportunities.closedAt / leads.createdAt", direction: "HIGHER_IS_BETTER" },
] as const;

const id = z.string().uuid();
const idem = z.string().trim().min(8).max(200);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const targetValue = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(BigInt);

export const goalQuotaInputSchema = z.object({
  targetType: z.enum(["MEMBER", "TEAM", "FUNCTION"]), memberId: id.nullish(), teamId: id.nullish(), function: z.enum(goalFunctions).nullish(),
  metricKey: z.enum(goalMetricKeys), unit: z.enum(["COUNT", "BASIS_POINTS", "CURRENCY_CENTS"]), targetValue, targetLabel: z.string().trim().min(2).max(160),
}).strict().superRefine((value, ctx) => {
  const validTarget = value.targetType === "MEMBER" ? Boolean(value.memberId && !value.teamId && !value.function) : value.targetType === "TEAM" ? Boolean(value.teamId && !value.memberId && !value.function) : Boolean(value.function && !value.memberId && !value.teamId);
  if (!validTarget) ctx.addIssue({ code: "custom", message: "Defina exatamente um alvo coerente com o tipo." });
  if (goalMetricUnits[value.metricKey] !== value.unit) ctx.addIssue({ code: "custom", message: "A unidade não corresponde à métrica canônica." });
  if (value.unit === "BASIS_POINTS" && value.targetValue > 10_000n) ctx.addIssue({ code: "custom", message: "Percentuais devem ficar entre 0 e 10.000 bps." });
});

export const createGoalPlanSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/), name: z.string().trim().min(3).max(160), description: z.string().trim().max(1_000).nullish(),
  periodStartDate: localDate, periodEndDate: localDate, quotas: z.array(goalQuotaInputSchema).min(1).max(200), idempotencyKey: idem,
}).strict();
export const updateGoalPlanSchema = createGoalPlanSchema.omit({ key: true, idempotencyKey: true }).extend({ expectedRevision: z.number().int().positive(), idempotencyKey: idem }).strict();
export const goalPlanActionSchema = z.object({ action: z.enum(["PUBLISH", "CREATE_VERSION", "RETIRE"]), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(1_000), idempotencyKey: idem }).strict();
export const goalQuerySchema = z.object({ planId: id.optional(), memberId: id.optional(), asOf: z.coerce.date().optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25) }).strict();

export type GoalQuotaInput = z.infer<typeof goalQuotaInputSchema>;
export type GoalMetricKeyValue = typeof goalMetricKeys[number];
export type GoalProgressState = "VALUE" | "ZERO" | "NO_DENOMINATOR" | "PARTIAL" | "NOT_APPLICABLE";

export function goalPeriodInstants(startDate: string, endDate: string, timeZone: string) {
  const start = parseWorkspaceLocalDateTime(`${startDate}T00:00`, timeZone);
  const end = parseWorkspaceLocalDateTime(`${addLocalDays(endDate, 1)}T00:00`, timeZone);
  if (end <= start) throw new Error("O fim do período deve ser igual ou posterior ao início.");
  return { start, end };
}

export function quotaTargetKey(input: Pick<GoalQuotaInput, "targetType" | "memberId" | "teamId" | "function">) {
  return input.targetType === "MEMBER" ? `MEMBER:${input.memberId}` : input.targetType === "TEAM" ? `TEAM:${input.teamId}` : `FUNCTION:${input.function}`;
}

export function resolveEffectiveQuota<T extends { metricKey: string; targetType: "MEMBER" | "TEAM" | "FUNCTION"; memberId: string | null; teamId: string | null; function: string | null }>(quotas: readonly T[], input: { memberId: string; teamIds: readonly string[]; functions: readonly string[] }): T | null {
  const candidates = quotas.filter((quota) => quota.metricKey && (quota.memberId === input.memberId || Boolean(quota.teamId && input.teamIds.includes(quota.teamId)) || Boolean(quota.function && input.functions.includes(quota.function))));
  return candidates.find((quota) => quota.targetType === "MEMBER") ?? candidates.find((quota) => quota.targetType === "TEAM") ?? candidates.find((quota) => quota.targetType === "FUNCTION") ?? null;
}

export function goalProgress(actual: bigint | null, target: bigint, state?: GoalProgressState) {
  if (state === "NO_DENOMINATOR" || actual === null) return { actualValue: null, attainmentBps: null, state: state ?? "NOT_APPLICABLE" } as const;
  if (target === 0n) return { actualValue: actual.toString(), attainmentBps: null, state: "NOT_APPLICABLE" as const };
  const attainmentBps = Number((actual * 10_000n) / target);
  return { actualValue: actual.toString(), attainmentBps, state: (actual === 0n ? "ZERO" : state ?? "VALUE") as GoalProgressState };
}
