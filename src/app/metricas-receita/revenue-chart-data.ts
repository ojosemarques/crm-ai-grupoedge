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
