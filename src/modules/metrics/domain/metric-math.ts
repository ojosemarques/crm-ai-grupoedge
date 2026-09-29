import type {
  CountMetric,
  DurationStatistics,
  RateMetric,
  SlaStatistics,
} from "@/modules/metrics/domain/metrics-contracts";

export function countMetric(value: number): CountMetric {
  return Object.freeze({ value, numerator: value, denominator: null });
}

export function rateMetric(numerator: number, denominator: number): RateMetric {
  if (denominator === 0) {
    return Object.freeze({
      numerator,
      denominator,
      basisPoints: null,
      percentage: null,
    });
  }
  const basisPoints = Math.round((numerator * 10_000) / denominator);
  return Object.freeze({
    numerator,
    denominator,
    basisPoints,
    percentage: basisPoints / 100,
  });
}

function percentile(sortedValues: readonly number[], fraction: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? null;
}

export function durationStatistics(values: readonly number[]): DurationStatistics {
  const sorted = [...values].map((value) => Math.max(0, Math.floor(value))).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return Object.freeze({
      sampleCount: 0,
      averageSeconds: null,
      medianSeconds: null,
      p90Seconds: null,
      minimumSeconds: null,
      maximumSeconds: null,
    });
  }
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? null);
  return Object.freeze({
    sampleCount: sorted.length,
    averageSeconds: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    medianSeconds: median,
    p90Seconds: percentile(sorted, 0.9),
    minimumSeconds: sorted[0] ?? null,
    maximumSeconds: sorted.at(-1) ?? null,
  });
}

export function slaStatistics(
  values: readonly (number | null)[],
): SlaStatistics {
  const measured = values.filter((value): value is number => value !== null);
  return Object.freeze({
    ...durationStatistics(measured),
    upTo60Seconds: measured.filter((value) => value <= 60).length,
    upTo180Seconds: measured.filter((value) => value <= 180).length,
    missingCount: values.length - measured.length,
  });
}
