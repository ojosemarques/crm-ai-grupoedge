import { describe, expect, it } from "vitest";
import { commercialMetricQuality, COMMERCIAL_METRIC_BACKFILL_RULE_VERSION, COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION } from "./commercial-metric-quality";

const applied = { mode: "APPLY", status: "COMPLETED", ruleVersion: COMMERCIAL_METRIC_BACKFILL_RULE_VERSION, reviewCount: 0, skippedCount: 0, failedCount: 0, finishedAt: new Date("2052-04-20T10:00:00.000Z") };
const reconciled = { status: "COMPLETED", ruleVersion: COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION, divergentCheckCount: 0, finishedAt: new Date("2052-04-20T10:05:00.000Z") };

describe("qualidade do log comercial", () => {
  it("confirma cobertura somente após aplicação e conciliação das regras atuais", () => {
    expect(commercialMetricQuality(applied, reconciled)).toMatchObject({ historicalCoverageBasisPoints: 10_000, reconciliationState: "AVAILABLE" });
    expect(commercialMetricQuality({ ...applied, mode: "DRY_RUN" }, reconciled)).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "PARTIAL" });
    expect(commercialMetricQuality({ ...applied, ruleVersion: applied.ruleVersion - 1 }, reconciled)).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "PARTIAL" });
    expect(commercialMetricQuality(applied, { ...reconciled, finishedAt: new Date("2052-04-20T09:55:00.000Z") })).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "PARTIAL" });
  });

  it("não reutiliza conciliação antiga ou divergente como prova de dados completos", () => {
    expect(commercialMetricQuality(applied, { ...reconciled, ruleVersion: reconciled.ruleVersion - 1 })).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "UNAVAILABLE" });
    expect(commercialMetricQuality(applied, { ...reconciled, divergentCheckCount: 1 })).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "PARTIAL" });
    expect(commercialMetricQuality(applied, null)).toMatchObject({ historicalCoverageBasisPoints: null, reconciliationState: "UNAVAILABLE" });
  });
});
