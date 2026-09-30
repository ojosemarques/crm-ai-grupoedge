import type {
  DashboardPeriodInterval,
  DashboardPeriodPreset,
} from "@/modules/metrics/domain/dashboard-contracts";
import type { MetricsFilters } from "@/modules/metrics/domain/metrics-contracts";

export const revenueMetricStates = [
  "AVAILABLE",
  "ZERO",
  "NO_DENOMINATOR",
  "UNAVAILABLE",
  "NOT_APPLICABLE",
  "PARTIAL",
  "SUPPRESSED",
] as const;

export type RevenueMetricState = (typeof revenueMetricStates)[number];
export type RevenueMetricUnit = "COUNT" | "CENTS" | "BASIS_POINTS" | "SECONDS";
export type RevenueMetricDirection = "UP" | "DOWN" | "STABLE" | "NOT_COMPARABLE";
export type RevenueMetricInterpretation = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "CONTEXT_REQUIRED" | "NOT_ENOUGH_DATA";

export type RevenueMetricDefinition = Readonly<{
  id: string;
  version: number;
  name: string;
  description: string;
  objective: string;
  unit: RevenueMetricUnit;
  sourceOfTruth: readonly string[];
  numerator: string;
  denominator: string | null;
  formula: string;
  factTimestamp: string;
  supportedDateBases: readonly string[];
  periodRule: string;
  timeZoneRule: string;
  asOfRule: string;
  cohortRule: string | null;
  supportedFilters: readonly string[];
  supportedDimensions: readonly string[];
  cancellationRule: string;
  reversalRule: string;
  duplicateRule: string;
  coverageRule: string;
  limitations: readonly string[];
  comparisonRule: string;
  drilldownRule: string;
  permission: "metrics.read";
  desiredDirection: "UP" | "DOWN" | "CONTEXT";
}>;

export type RevenueMetricValue = Readonly<{
  metricId: string;
  definitionVersion: number;
  state: RevenueMetricState;
  value: string | number | null;
  numerator: string | number | null;
  denominator: string | number | null;
  currency: "BRL" | null;
  coverageBasisPoints: number | null;
  reason: string;
  drilldownId: string | null;
}>;

export type RevenueMetricComparison = Readonly<{
  metricId: string;
  current: RevenueMetricValue;
  previous: RevenueMetricValue;
  absoluteDifference: string | number | null;
  percentageDifferenceBasisPoints: number | null;
  direction: RevenueMetricDirection;
  interpretation: RevenueMetricInterpretation;
  currentPeriod: DashboardPeriodInterval;
  previousPeriod: DashboardPeriodInterval;
}>;

export type RevenueBridge = Readonly<{
  openingMrrCents: string;
  newMrrCents: string;
  expansionMrrCents: string;
  reactivationMrrCents: string;
  contractionMrrCents: string;
  churnMrrCents: string;
  adjustmentsCents: string;
  netNewMrrCents: string;
  closingMrrCents: string;
  reconciled: boolean;
}>;

export type RevenueTimeSeriesPoint = Readonly<{
  bucket: string;
  from: string;
  to: string;
  value: string | number | null;
  state: RevenueMetricState;
}>;

export type RevenueTimeSeries = Readonly<{
  metricId: string;
  granularity: "DAY" | "WEEK" | "MONTH";
  points: readonly RevenueTimeSeriesPoint[];
}>;

export type RevenueCohortRow = Readonly<{
  cohort: string;
  subscriptionCount: number;
  initialMrrCents: string;
  currentMrrCents: string;
  retentionBasisPoints: number | null;
  state: RevenueMetricState;
  censored: boolean;
  drilldownId: string;
}>;

export type RevenueQualitySignal = Readonly<{
  id: string;
  label: string;
  state: RevenueMetricState;
  coverageBasisPoints: number | null;
  detail: string;
  action: string | null;
  drilldownId: string | null;
}>;

export type RevenueDrilldownRecord = Readonly<{
  key: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string;
  occurredAt: string;
  contribution: string | number | null;
  unit: RevenueMetricUnit;
  href: string;
  provenance: string;
}>;

export type RevenueMetricsQuery = Readonly<{
  preset: DashboardPeriodPreset;
  period: DashboardPeriodInterval;
  comparisonPeriod: DashboardPeriodInterval;
  asOf: string;
  filters: MetricsFilters;
}>;

export type RevenueMetricsScreen = Readonly<{
  registryVersion: string;
  generatedAt: string;
  scope: "WORKSPACE" | "TEAM" | "OWN";
  query: RevenueMetricsQuery;
  metrics: readonly RevenueMetricValue[];
  comparisons: readonly RevenueMetricComparison[];
  bridge: RevenueBridge;
  series: readonly RevenueTimeSeries[];
  cohorts: readonly RevenueCohortRow[];
  quality: readonly RevenueQualitySignal[];
  forecastSnapshot: Readonly<{
    id: string;
    asOf: string;
    coverageState: string;
    coverageBasisPoints: number;
  }> | null;
  hasData: boolean;
}>;

export type RevenueDrilldownPage = Readonly<{
  metric: RevenueMetricDefinition;
  query: RevenueMetricsQuery;
  records: readonly RevenueDrilldownRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;
