import type {
  IntegratedMetricsOverview,
  MetricsFilters,
  MetricsOverview,
} from "@/modules/metrics/domain/metrics-contracts";
import type { EmailCadenceMetricsRow } from "@/modules/metrics/domain/email-cadence-metrics";

export const dashboardPeriodPresets = [
  "TODAY",
  "YESTERDAY",
  "WEEK",
  "MONTH",
  "CUSTOM",
] as const;

export type DashboardPeriodPreset = (typeof dashboardPeriodPresets)[number];

export type DashboardQuery = Readonly<{
  preset: DashboardPeriodPreset;
  fromDate: string;
  toDate: string;
  from: string;
  to: string;
  filters: MetricsFilters;
}>;

export type DashboardRecord = Readonly<{
  key: string;
  entityType: "LEAD" | "MEETING" | "OPPORTUNITY" | "SLA_CYCLE" | "AUTOMATION_RUN";
  entityId: string;
  leadId: string;
  title: string;
  subtitle: string;
  occurredAt: string;
  responsibleName: string | null;
  status: string | null;
  amountCents: string | null;
  href: string;
}>;

export type DashboardDrilldown = Readonly<{
  id: string;
  title: string;
  description: string;
  formula: string;
  recordKeys: readonly string[];
}>;

export type DashboardKpi = Readonly<{
  id: string;
  label: string;
  kind: "COUNT" | "RATE" | "MONEY" | "DURATION";
  value: number | string | null;
  numerator: number | string;
  denominator: number | null;
  detail: string;
  drilldownId: string;
}>;

export type DashboardTrendDirection = "UP" | "DOWN" | "STABLE" | "NOT_COMPARABLE";

export type DashboardMetricInterpretation =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "CONTEXT_REQUIRED"
  | "NOT_ENOUGH_DATA";

export type DashboardPeriodInterval = Readonly<{
  fromDate: string;
  toDate: string;
  from: string;
  to: string;
  timeZone: string;
}>;

export type DashboardComparisonValue = Readonly<{
  value: number | string | null;
  numerator: number | string;
  denominator: number | null;
  drilldownId: string;
}>;

export type DashboardComparison = Readonly<{
  id: string;
  label: string;
  kind: "COUNT" | "RATE" | "MONEY" | "DURATION";
  current: DashboardComparisonValue;
  previous: DashboardComparisonValue;
  absoluteDifference: number | string | null;
  percentageDifference: number | null;
  direction: DashboardTrendDirection;
  interpretation: DashboardMetricInterpretation;
  interpretationLabel: string;
  currentPeriod: DashboardPeriodInterval;
  previousPeriod: DashboardPeriodInterval;
}>;

export type DashboardTimeSeriesGranularity = "HOUR" | "DAY" | "WEEK";

export type DashboardTimeSeriesPoint = Readonly<{
  bucket: string;
  from: string;
  to: string;
  value: number | string | null;
  numerator: number | string;
  denominator: number | null;
}>;

export type DashboardTimeSeries = Readonly<{
  id: string;
  label: string;
  kind: "COUNT" | "RATE" | "MONEY" | "DURATION";
  granularity: DashboardTimeSeriesGranularity;
  aggregation: "SUM" | "RATE" | "MEDIAN" | "P90";
  formula: string;
  drilldownId: string;
  points: readonly DashboardTimeSeriesPoint[];
}>;

export type DashboardFunnelNode = DashboardSegment & Readonly<{
  branchFrom: string | null;
  nodeType: "STAGE" | "OUTCOME";
}>;

export type DashboardFunnelFlow = Readonly<{
  stages: readonly DashboardFunnelNode[];
  outcomes: readonly DashboardFunnelNode[];
}>;

export type DashboardAttentionItem = Readonly<{
  id: string;
  label: string;
  value: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
  detail: string;
  drilldownId: string;
}>;

export type DashboardPerformanceRow = Readonly<{
  id: string;
  name: string;
  role: "SDR" | "CLOSER";
  volume: number;
  conversionPercentage: number | null;
  revenueCents: string;
  slaSeconds: number | null;
  meetings: number;
  showRate: number | null;
  drilldownId: string;
}>;

export type DashboardSellerActivity = Readonly<{
  id: string;
  name: string;
  tasksCompleted: number;
  stageEntries: number;
  calls: number;
  connected: number;
  effectiveContacts: number;
  unanswered: number;
  callbackRequested: number;
  whatsappShared: number;
  noAnswer: number;
  busy: number;
  voicemail: number;
  otherUnanswered: number;
  callFailed: number;
  wrongNumber: number;
  channelUnavailable: number;
  otherFailures: number;
  withoutOutcome: number;
  instagramMessages: number;
  instagramFollows: number;
  emailsSent: number;
  instagramMessagesProfileNotFound: number;
  instagramMessagesFailed: number;
  instagramFollowsAlreadyFollowing: number;
  instagramFollowsProfileNotFound: number;
  instagramFollowsFailed: number;
  qualified: number;
  meetingsScheduled: number;
  meetingStageMarked: number;
  proposals: number;
  sales: number;
  salesValueCents: string;
}>;

export type DashboardSegment = Readonly<{
  id: string;
  label: string;
  value: number;
  denominator: number | null;
  percentage: number | null;
  secondaryValue: number | string | null;
  secondaryLabel: string | null;
  drilldownId: string;
}>;

export type DashboardFilterOption = Readonly<{ id: string; name: string }>;

export type DashboardFilterOptions = Readonly<{
  sdrs: readonly DashboardFilterOption[];
  closers: readonly DashboardFilterOption[];
  teams: readonly DashboardFilterOption[];
  sources: readonly DashboardFilterOption[];
  campaigns: readonly DashboardFilterOption[];
  creatives: readonly DashboardFilterOption[];
  priorities: readonly Readonly<{ id: "P1" | "P2" | "P3"; name: string }>[];
  products: readonly DashboardFilterOption[];
}>;

export type DashboardScreen = Readonly<{
  query: DashboardQuery;
  comparisonPeriod: DashboardPeriodInterval;
  overview: MetricsOverview;
  integrated: IntegratedMetricsOverview;
  kpis: readonly DashboardKpi[];
  comparisons: readonly DashboardComparison[];
  timeSeries: readonly DashboardTimeSeries[];
  previousTimeSeries: readonly DashboardTimeSeries[];
  funnel: readonly DashboardSegment[];
  fullFunnel: DashboardFunnelFlow;
  attention: readonly DashboardAttentionItem[];
  stageConversion: readonly DashboardSegment[];
  stageTime: readonly DashboardSegment[];
  sdrPerformance: readonly DashboardSegment[];
  closerPerformance: readonly DashboardSegment[];
  performance: readonly DashboardPerformanceRow[];
  sellerActivity: readonly DashboardSellerActivity[];
  emailCadence: readonly EmailCadenceMetricsRow[];
  cohortByStage: readonly DashboardSegment[];
  sources: readonly DashboardSegment[];
  sourceConversion: readonly DashboardSegment[];
  campaigns: readonly DashboardSegment[];
  creatives: readonly DashboardSegment[];
  priorities: readonly DashboardSegment[];
  disqualificationReasons: readonly DashboardSegment[];
  lossReasons: readonly DashboardSegment[];
  noShowReasons: readonly DashboardSegment[];
  pactoQuality: readonly DashboardSegment[];
  backlogByStage: readonly DashboardSegment[];
  agingByStage: readonly DashboardSegment[];
  filterOptions: DashboardFilterOptions;
  records: readonly DashboardRecord[];
  drilldowns: readonly DashboardDrilldown[];
  hasData: boolean;
}>;

export type DashboardDrilldownPage = Readonly<{
  generatedAt: string;
  query: DashboardQuery;
  period: DashboardPeriodInterval;
  timeZone: string;
  drilldown: Omit<DashboardDrilldown, "recordKeys">;
  records: readonly DashboardRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;
