import { describe, expect, it } from "vitest";

import {
  countMetric,
  durationStatistics,
  rateMetric,
  slaStatistics,
} from "@/modules/metrics/domain/metric-math";

describe("matemática das métricas", () => {
  it("expõe numerador, denominador e taxa em pontos-base", () => {
    expect(rateMetric(2, 3)).toEqual({
      numerator: 2,
      denominator: 3,
      basisPoints: 6667,
      percentage: 66.67,
    });
    expect(rateMetric(0, 0)).toEqual({
      numerator: 0,
      denominator: 0,
      basisPoints: null,
      percentage: null,
    });
    expect(countMetric(7)).toEqual({ value: 7, numerator: 7, denominator: null });
  });

  it("calcula média, mediana, P90 e extremos de modo reproduzível", () => {
    expect(durationStatistics([180, 10, 60, 240])).toEqual({
      sampleCount: 4,
      averageSeconds: 123,
      medianSeconds: 120,
      p90Seconds: 240,
      minimumSeconds: 10,
      maximumSeconds: 240,
    });
  });

  it("separa medições ausentes e faixas cumulativas do SLA", () => {
    expect(slaStatistics([0, 60, 61, 180, 181, null])).toMatchObject({
      sampleCount: 5,
      upTo60Seconds: 2,
      upTo180Seconds: 4,
      missingCount: 1,
      minimumSeconds: 0,
      maximumSeconds: 181,
    });
  });
});
