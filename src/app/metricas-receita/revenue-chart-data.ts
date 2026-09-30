import type { RevenueTimeSeries } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueMetricRegistryById } from "@/modules/metrics/domain/revenue-metric-registry";

export function revenueChartData(metricId: string, series: readonly RevenueTimeSeries[]) {
  const money = revenueMetricRegistryById.get(metricId)?.unit === "CENTS";
  const source = series.find((item) => item.metricId === metricId);
  return {
    money,
    points: source?.points.map((point) => {
      const parsed = point.value === null ? null : Number(point.value);
      return { bucket: point.bucket, value: parsed !== null && Number.isSafeInteger(parsed) ? (money ? parsed / 100 : parsed) : null, state: point.state };
    }) ?? [],
  };
}

/** Null buckets break paths; zero is a real observation on the baseline. */
export function revenueLineSegments(points: readonly { value: number | null }[]) {
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ index, value: point.value });
  });
  if (current.length) segments.push(current);
  return segments;
}

export function revenueChartDomain(values: readonly (number | null)[]) {
  const numbers = values.filter((value): value is number => value !== null);
  const minimum = Math.min(0, ...numbers);
  const maximum = Math.max(0, ...numbers);
  return { minimum, maximum: minimum === maximum ? 1 : maximum };
}
