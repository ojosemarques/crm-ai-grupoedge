import { createHash } from "node:crypto";
import { z } from "zod";

export const forecastCategories = ["PIPELINE", "BEST_CASE", "COMMIT"] as const;
export const forecastScopeTypes = ["WORKSPACE", "TEAM", "FUNCTION"] as const;
export const forecastFunctions = ["MARKETING", "SDR", "CLOSER", "CUSTOMER_SUCCESS", "FARMER", "FINANCE", "REVOPS"] as const;
export type ForecastCategoryValue = typeof forecastCategories[number];
export type ForecastCoverageValue = "COMPLETE" | "PARTIAL" | "NOT_AVAILABLE";

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(200);
const cents = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(BigInt);

export const forecastQuerySchema = z.object({
  cycleId: uuid.optional(),
  asOf: z.coerce.date().optional(),
  memberId: uuid.optional(),
  compareFromId: uuid.optional(),
  compareToId: uuid.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).strict();

export const createForecastCycleSchema = z.object({
  goalPlanId: uuid.nullish(),
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/),
  name: z.string().trim().min(3).max(160),
  scopeType: z.enum(forecastScopeTypes),
  teamId: uuid.nullish(),
  function: z.enum(forecastFunctions).nullish(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  timeZone: z.string().trim().min(3).max(80),
  currency: z.literal("BRL").default("BRL"),
  idempotencyKey,
}).strict().superRefine((value, ctx) => {
  if (value.periodEnd <= value.periodStart) ctx.addIssue({ code: "custom", message: "O fim do ciclo deve ser posterior ao início." });
  const validScope = value.scopeType === "WORKSPACE" ? !value.teamId && !value.function : value.scopeType === "TEAM" ? Boolean(value.teamId && !value.function) : Boolean(value.function && !value.teamId);
  if (!validScope) ctx.addIssue({ code: "custom", message: "O alvo do ciclo não corresponde ao tipo de escopo." });
});

export const createForecastSubmissionSchema = z.object({
  cycleId: uuid,
  category: z.enum(forecastCategories),
  declaredValueCents: cents,
  opportunityIds: z.array(uuid).max(500).default([]),
  comment: z.string().trim().max(2_000).nullish(),
  correctionReason: z.string().trim().min(3).max(1_000).nullish(),
  targetMemberId: uuid.nullish(),
  targetTeamId: uuid.nullish(),
  type: z.enum(["INDIVIDUAL", "MANAGER_OVERRIDE"]).default("INDIVIDUAL"),
  asOf: z.coerce.date(),
  idempotencyKey,
}).strict().superRefine((value, ctx) => {
  if (value.type === "INDIVIDUAL" && value.targetTeamId) ctx.addIssue({ code: "custom", message: "Submissão individual não pode declarar equipe." });
  if (value.type === "MANAGER_OVERRIDE" && (!value.targetTeamId || value.targetMemberId)) ctx.addIssue({ code: "custom", message: "Override gerencial exige uma equipe e não aceita pessoa." });
});

export const consolidateForecastSchema = z.object({
  cycleId: uuid,
  asOf: z.coerce.date(),
  idempotencyKey,
}).strict();

export const compareForecastSchema = z.object({ fromSnapshotId: uuid, toSnapshotId: uuid }).strict();
export const forecastBackfillSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: idempotencyKey }).strict();

export type ForecastOpportunityFact = Readonly<{
  id: string;
  status: "OPEN" | "WON" | "LOST" | "CANCELLED";
  amountCents: bigint;
  currency: string;
  expectedCloseAt: Date | null;
  ownerMemberId: string;
  teamId: string | null;
  category: ForecastCategoryValue | null;
  probabilityBps: number | null;
  probabilitySource: string | null;
  probabilityActorId: string | null;
  probabilityRecordedAt: Date | null;
  productAvailability: "DRAFT" | "AVAILABLE" | "CAPACITY_LIMITED" | "FUTURE" | "RETIRED" | null;
  evidenceCount: number;
}>;

export function forecastEligibility(fact: ForecastOpportunityFact, cycle: Readonly<{ periodStart: Date; periodEnd: Date; currency: string; scopeType: string; teamId: string | null; functionMemberIds?: readonly string[]; memberIds?: readonly string[] }>) {
  if (fact.status !== "OPEN") return { eligible: false, reasonCode: fact.status } as const;
  if (fact.productAvailability === "FUTURE") return { eligible: false, reasonCode: "PRODUCT_NOT_AVAILABLE" } as const;
  if (fact.evidenceCount < 1) return { eligible: false, reasonCode: "MISSING_EVIDENCE" } as const;
  if (fact.amountCents <= 0n) return { eligible: false, reasonCode: "MISSING_VALUE" } as const;
  if (fact.currency !== cycle.currency) return { eligible: false, reasonCode: "CURRENCY_MISMATCH" } as const;
  if (!fact.expectedCloseAt) return { eligible: false, reasonCode: "MISSING_EXPECTED_CLOSE" } as const;
  if (fact.expectedCloseAt < cycle.periodStart || fact.expectedCloseAt >= cycle.periodEnd) return { eligible: false, reasonCode: "OUTSIDE_PERIOD" } as const;
  if (cycle.scopeType === "TEAM" && fact.teamId !== cycle.teamId) return { eligible: false, reasonCode: "OUTSIDE_SCOPE" } as const;
  if (cycle.scopeType === "FUNCTION" && !cycle.functionMemberIds?.includes(fact.ownerMemberId)) return { eligible: false, reasonCode: "OUTSIDE_SCOPE" } as const;
  if (cycle.memberIds && !cycle.memberIds.includes(fact.ownerMemberId)) return { eligible: false, reasonCode: "OUTSIDE_SCOPE" } as const;
  return { eligible: true, reasonCode: "ELIGIBLE" } as const;
}

type ForecastAggregateFact = Pick<ForecastOpportunityFact, "amountCents" | "category" | "probabilityBps" | "probabilitySource" | "probabilityActorId" | "probabilityRecordedAt">;

export function aggregateForecast<T extends ForecastAggregateFact>(items: readonly T[]) {
  const eligible = items.filter((item) => item.category !== null);
  const pipelineCents = eligible.reduce((total, item) => total + item.amountCents, 0n);
  const bestCaseCents = eligible.filter((item) => item.category === "BEST_CASE" || item.category === "COMMIT").reduce((total, item) => total + item.amountCents, 0n);
  const commitCents = eligible.filter((item) => item.category === "COMMIT").reduce((total, item) => total + item.amountCents, 0n);
  const withProbability = eligible.filter((item) => item.probabilityBps !== null && item.probabilitySource && item.probabilityActorId && item.probabilityRecordedAt);
  const coverageBps = eligible.length === 0 ? 0 : Math.floor((withProbability.length * 10_000) / eligible.length);
  const coverageState: ForecastCoverageValue = eligible.length === 0 ? "NOT_AVAILABLE" : coverageBps === 10_000 ? "COMPLETE" : "PARTIAL";
  const weightedPipelineCents = coverageState === "COMPLETE" ? withProbability.reduce((total, item) => total + ((item.amountCents * BigInt(item.probabilityBps!)) / 10_000n), 0n) : null;
  return { pipelineCents, bestCaseCents, commitCents, weightedPipelineCents, opportunityCount: eligible.length, coverageBps, coverageState };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return typeof value === "bigint" ? JSON.stringify(value.toString()) : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function forecastFingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export type ForecastMovementType = "PIPELINE_ENTERED" | "CATEGORY_ADVANCED" | "CATEGORY_RETREATED" | "VALUE_INCREASED" | "VALUE_DECREASED" | "CLOSE_DATE_CHANGED" | "WON" | "LOST" | "REMOVED_BY_RULE" | "OWNER_CHANGED";
export type ForecastComparableItem = Readonly<{ opportunityId: string; eligible: boolean; category: ForecastCategoryValue | null; amountCents: bigint; expectedCloseAt: Date | null; ownerMemberId: string; teamId: string | null; status: "OPEN" | "WON" | "LOST" | "CANCELLED"; reasonCode: string }>;

export function compareForecastItems(fromItems: readonly ForecastComparableItem[], toItems: readonly ForecastComparableItem[]) {
  const from = new Map(fromItems.map((item) => [item.opportunityId, item]));
  const to = new Map(toItems.map((item) => [item.opportunityId, item]));
  const rank = { PIPELINE: 1, BEST_CASE: 2, COMMIT: 3 } as const;
  const movements: Array<{ opportunityId: string; type: ForecastMovementType; deltaCents: bigint; fromCategory: ForecastCategoryValue | null; toCategory: ForecastCategoryValue | null }> = [];
  for (const opportunityId of new Set([...from.keys(), ...to.keys()])) {
    const previous = from.get(opportunityId); const current = to.get(opportunityId);
    if ((!previous || !previous.eligible) && current?.eligible) movements.push({ opportunityId, type: "PIPELINE_ENTERED", deltaCents: current.amountCents, fromCategory: previous?.category ?? null, toCategory: current.category });
    if (previous?.eligible && current && !current.eligible) movements.push({ opportunityId, type: current.status === "WON" ? "WON" : current.status === "LOST" ? "LOST" : "REMOVED_BY_RULE", deltaCents: -previous.amountCents, fromCategory: previous.category, toCategory: null });
    if (previous?.eligible && current?.eligible) {
      const beforeRank = previous.category ? rank[previous.category] : 0; const afterRank = current.category ? rank[current.category] : 0;
      if (afterRank > beforeRank) movements.push({ opportunityId, type: "CATEGORY_ADVANCED", deltaCents: current.amountCents, fromCategory: previous.category, toCategory: current.category });
      if (afterRank < beforeRank) movements.push({ opportunityId, type: "CATEGORY_RETREATED", deltaCents: -current.amountCents, fromCategory: previous.category, toCategory: current.category });
      if (current.amountCents > previous.amountCents) movements.push({ opportunityId, type: "VALUE_INCREASED", deltaCents: current.amountCents - previous.amountCents, fromCategory: previous.category, toCategory: current.category });
      if (current.amountCents < previous.amountCents) movements.push({ opportunityId, type: "VALUE_DECREASED", deltaCents: current.amountCents - previous.amountCents, fromCategory: previous.category, toCategory: current.category });
      if (current.expectedCloseAt?.getTime() !== previous.expectedCloseAt?.getTime()) movements.push({ opportunityId, type: "CLOSE_DATE_CHANGED", deltaCents: 0n, fromCategory: previous.category, toCategory: current.category });
      if (current.ownerMemberId !== previous.ownerMemberId || current.teamId !== previous.teamId) movements.push({ opportunityId, type: "OWNER_CHANGED", deltaCents: 0n, fromCategory: previous.category, toCategory: current.category });
    }
  }
  return movements;
}

export function percentageDelta(current: bigint, previous: bigint) {
  if (previous === 0n) return null;
  return Number(((current - previous) * 10_000n) / previous);
}
