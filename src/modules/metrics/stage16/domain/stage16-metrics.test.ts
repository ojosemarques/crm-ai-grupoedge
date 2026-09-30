import { describe, expect, it } from "vitest";

import { getRevenueMetricDefinition } from "@/modules/metrics/domain/revenue-metric-registry";
import { buildCadenceMetrics, buildCostAndSampleQuality, buildFinancialMetrics, STAGE16_METRIC_IDS, stage16MetricsQuerySchema, type CadenceFact } from "./stage16-metrics";

const complete: CadenceFact = { opportunityId: "o1", status: "OPEN", amountCents: 100_00n, offerCohort: "SKU-A", icpCohort: "PUBLIC:MEDIUM", decisionMaker: true, sponsor: true, diagnosis: true, pilot: true, plannedWait: false, commitment: true, stage: true };

describe("métricas da cadência longa", () => {
  it("mede cada evidência e mantém coortes de oferta/ICP separadas", () => {
    const result = buildCadenceMetrics([complete, { ...complete, opportunityId: "o2", status: "WON", amountCents: 50_00n, diagnosis: false, offerCohort: "SKU-B" }]);
    expect(result.coverage.decisionMaker).toEqual({ covered: 2, total: 2, coverageBps: 10_000 });
    expect(result.coverage.diagnosis.coverageBps).toBe(5_000);
    expect(result.cohorts).toHaveLength(2);
    expect(result.cohorts.find((item) => item.offerCohort === "SKU-B")).toMatchObject({ wins: 1, pipelineCents: 0n });
  });

  it("separa contratado, MRR, entrega e caixa recebido", () => {
    expect(buildFinancialMetrics([{ contractedCents: 120_000n, contractedMrrCents: 10_000n, deliveredServiceCents: 30_000n, receivedCents: 20_000n }, { contractedCents: 0n, contractedMrrCents: 0n, deliveredServiceCents: 0n, receivedCents: -5_000n }])).toEqual({ contractedCents: 120_000n, contractedMrrCents: 10_000n, deliveredServiceCents: 30_000n, receivedCents: 15_000n });
  });

  it("expõe custo e qualidade sem inventar denominador", () => {
    expect(buildCostAndSampleQuality({ mediaCostCents: 1_000n, outboundCostCents: 300n, aiCostCents: 200n, mediaSamples: 2, outboundSamples: 1, aiSamples: 0, mediaMissingCostSamples: 1, outboundMissingCostSamples: 0, aiMissingCostSamples: 0 }, [complete])).toEqual({ costs: { mediaCents: 1_000n, outboundCents: 300n, campaignsCents: 1_300n, aiCents: 200n, totalCents: 1_500n }, sampleQuality: { opportunitySamples: 1, completeCadenceSamples: 1, completeCadenceBps: 10_000, mediaSamples: 2, mediaCostCoverageBps: 5_000, outboundSamples: 1, outboundCostCoverageBps: 10_000, aiSamples: 0, aiCostCoverageBps: null } });
    expect(buildCadenceMetrics([]).coverage.stage.coverageBps).toBeNull();
  });

  it("valida período e corte", () => {
    expect(stage16MetricsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-10-01", asOf: "2026-09-30" }).success).toBe(true);
    expect(stage16MetricsQuerySchema.safeParse({ from: "2026-10-01", to: "2026-09-01" }).success).toBe(false);
  });

  it("publica todas as fórmulas no registro canônico consumido pelo builder", () => {
    const ids = Object.values(STAGE16_METRIC_IDS).flat();
    expect(ids).toHaveLength(18);
    expect(ids.every((id) => getRevenueMetricDefinition(id)?.formula)).toBe(true);
  });
});
