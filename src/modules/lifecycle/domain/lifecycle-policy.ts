import type {
  LifecycleSource,
  OwnershipFunction,
  RevenueLifecycleStage,
} from "@/generated/prisma/client";

export const LIFECYCLE_RULE_KEY = "revenue-lifecycle-v1";
export const LIFECYCLE_RULE_VERSION = 1;

const allowedTransitions: Readonly<Record<RevenueLifecycleStage, readonly RevenueLifecycleStage[]>> = {
  UNKNOWN: ["PROSPECT", "LEAD", "INACTIVE"],
  PROSPECT: ["LEAD", "INACTIVE"],
  LEAD: ["QUALIFIED", "OPPORTUNITY", "INACTIVE"],
  QUALIFIED: ["OPPORTUNITY", "INACTIVE"],
  OPPORTUNITY: ["CUSTOMER", "INACTIVE"],
  CUSTOMER: ["ONBOARDING", "INACTIVE"],
  ONBOARDING: ["ACTIVE", "INACTIVE"],
  ACTIVE: ["RENEWAL", "INACTIVE"],
  RENEWAL: ["ACTIVE", "CHURN", "INACTIVE"],
  CHURN: ["PROSPECT", "INACTIVE"],
  INACTIVE: ["PROSPECT", "LEAD"],
};

const requiredFunctionByStage: Readonly<Partial<Record<RevenueLifecycleStage, OwnershipFunction>>> = {
  LEAD: "SDR",
  QUALIFIED: "SDR",
  OPPORTUNITY: "CLOSER",
  CUSTOMER: "CLOSER",
  ONBOARDING: "CUSTOMER_SUCCESS",
  ACTIVE: "CUSTOMER_SUCCESS",
  RENEWAL: "FARMER",
};

const forbiddenAutomaticTargets = new Set<RevenueLifecycleStage>(["ACTIVE", "RENEWAL", "CHURN"]);

export const lifecycleRuleDefinitions = Object.entries(allowedTransitions).flatMap(([fromStage, targets]) =>
  targets.map((toStage) => ({
    fromStage: fromStage as RevenueLifecycleStage,
    toStage,
    requiredFunctions: requiredFunctionByStage[toStage] ? [requiredFunctionByStage[toStage]!] : [],
    allowedSources: forbiddenAutomaticTargets.has(toStage)
      ? (["HUMAN", "HANDOFF_EVENT"] as const)
      : (["HUMAN", "LEAD_EVENT", "OPPORTUNITY_EVENT", "HANDOFF_EVENT", "BACKFILL", "SYSTEM_RULE", "SEED"] as const),
  })),
);

export function isLifecycleTransitionAllowed(
  from: RevenueLifecycleStage,
  to: RevenueLifecycleStage,
  options: Readonly<{ override?: boolean; source: LifecycleSource }>,
): boolean {
  if (from === to) return false;
  if (options.override) return true;
  if (!allowedTransitions[from].includes(to)) return false;
  if (forbiddenAutomaticTargets.has(to) && !["HUMAN", "HANDOFF_EVENT"].includes(options.source)) return false;
  return true;
}

export function requiredOwnershipFunction(stage: RevenueLifecycleStage): OwnershipFunction | null {
  return requiredFunctionByStage[stage] ?? null;
}

export function chooseConservativeLifecycle(input: Readonly<{
  hasLead: boolean;
  hasQualifiedHistory: boolean;
  hasOpenOpportunity: boolean;
}>): RevenueLifecycleStage {
  if (input.hasOpenOpportunity) return "OPPORTUNITY";
  if (input.hasQualifiedHistory) return "QUALIFIED";
  if (input.hasLead) return "LEAD";
  return "UNKNOWN";
}

export function isFutureStageWithoutCurrentEvidence(stage: RevenueLifecycleStage): boolean {
  return ["ACTIVE", "RENEWAL", "CHURN"].includes(stage);
}
