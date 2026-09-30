import { z } from "zod";

export const STAGE16_METRIC_IDS = Object.freeze({
  cadence: ["cadence.decision_maker_coverage", "cadence.sponsor_coverage", "cadence.diagnosis_coverage", "cadence.pilot_coverage", "cadence.planned_wait_coverage", "cadence.commitment_coverage", "cadence.stage_coverage"],
  financial: ["sales.bookings", "sales.contracted_mrr", "delivery.service_project_delivered", "cash.received"],
  costs: ["cost.media", "cost.outbound", "cost.ai"],
  quality: ["quality.cadence_complete", "quality.media_cost", "quality.outbound_cost", "quality.ai_cost"],
} as const);

export const stage16MetricsQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  asOf: z.coerce.date().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.to <= value.from) ctx.addIssue({ code: "custom", message: "O fim do período deve ser posterior ao início." });
  if (value.asOf && (value.asOf < value.from || value.asOf > value.to)) ctx.addIssue({ code: "custom", message: "O corte deve pertencer ao período." });
});

export type CadenceFact = Readonly<{
  opportunityId: string;
  status: "OPEN" | "WON" | "LOST" | "CANCELLED";
  amountCents: bigint;
  offerCohort: string;
  icpCohort: string;
  decisionMaker: boolean;
  sponsor: boolean;
  diagnosis: boolean;
  pilot: boolean;
  plannedWait: boolean;
  commitment: boolean;
  stage: boolean;
}>;

export type FinancialFact = Readonly<{
  contractedCents: bigint;
  contractedMrrCents: bigint;
  deliveredServiceCents: bigint;
  receivedCents: bigint;
}>;

export type CostFact = Readonly<{ mediaCostCents: bigint; outboundCostCents: bigint; aiCostCents: bigint; mediaSamples: number; outboundSamples: number; aiSamples: number; mediaMissingCostSamples: number; outboundMissingCostSamples: number; aiMissingCostSamples: number }>;

function bps(numerator: number, denominator: number) {
  return denominator === 0 ? null : Math.floor((numerator * 10_000) / denominator);
}

export function buildCadenceMetrics(facts: readonly CadenceFact[]) {
  const dimensions = ["decisionMaker", "sponsor", "diagnosis", "pilot", "plannedWait", "commitment", "stage"] as const;
  const coverage = Object.fromEntries(dimensions.map((dimension) => {
    const covered = facts.filter((fact) => fact[dimension]).length;
    return [dimension, { covered, total: facts.length, coverageBps: bps(covered, facts.length) }];
  })) as Record<(typeof dimensions)[number], { covered: number; total: number; coverageBps: number | null }>;
  const cohort = new Map<string, { offerCohort: string; icpCohort: string; opportunities: number; wins: number; pipelineCents: bigint }>();
  for (const fact of facts) {
    const key = `${fact.offerCohort}\u0000${fact.icpCohort}`;
    const current = cohort.get(key) ?? { offerCohort: fact.offerCohort, icpCohort: fact.icpCohort, opportunities: 0, wins: 0, pipelineCents: 0n };
    current.opportunities += 1;
    current.wins += fact.status === "WON" ? 1 : 0;
    current.pipelineCents += fact.status === "OPEN" ? fact.amountCents : 0n;
    cohort.set(key, current);
  }
  return { coverage, cohorts: [...cohort.values()].sort((a, b) => a.offerCohort.localeCompare(b.offerCohort) || a.icpCohort.localeCompare(b.icpCohort)) };
}

export function buildFinancialMetrics(facts: readonly FinancialFact[]) {
  return facts.reduce((total, fact) => ({
    contractedCents: total.contractedCents + fact.contractedCents,
    contractedMrrCents: total.contractedMrrCents + fact.contractedMrrCents,
    deliveredServiceCents: total.deliveredServiceCents + fact.deliveredServiceCents,
    receivedCents: total.receivedCents + fact.receivedCents,
  }), { contractedCents: 0n, contractedMrrCents: 0n, deliveredServiceCents: 0n, receivedCents: 0n });
}

export function buildCostAndSampleQuality(cost: CostFact, cadenceFacts: readonly CadenceFact[]) {
  const completeCadenceSamples = cadenceFacts.filter((fact) => fact.decisionMaker && fact.sponsor && fact.diagnosis && fact.pilot && fact.commitment && fact.stage).length;
  return {
    costs: { mediaCents: cost.mediaCostCents, outboundCents: cost.outboundCostCents, campaignsCents: cost.mediaCostCents + cost.outboundCostCents, aiCents: cost.aiCostCents, totalCents: cost.mediaCostCents + cost.outboundCostCents + cost.aiCostCents },
    sampleQuality: {
      opportunitySamples: cadenceFacts.length,
      completeCadenceSamples,
      completeCadenceBps: bps(completeCadenceSamples, cadenceFacts.length),
      mediaSamples: cost.mediaSamples,
      mediaCostCoverageBps: bps(cost.mediaSamples - cost.mediaMissingCostSamples, cost.mediaSamples),
      outboundSamples: cost.outboundSamples,
      outboundCostCoverageBps: bps(cost.outboundSamples - cost.outboundMissingCostSamples, cost.outboundSamples),
      aiSamples: cost.aiSamples,
      aiCostCoverageBps: bps(cost.aiSamples - cost.aiMissingCostSamples, cost.aiSamples),
    },
  };
}
