export const metricsPriorityCodes = ["P1", "P2", "P3"] as const;

export type MetricsPriorityCode = (typeof metricsPriorityCodes)[number];

export type MetricsFilters = Readonly<{
  sdrMemberIds: readonly string[];
  closerMemberIds: readonly string[];
  teamIds: readonly string[];
  sourceIds: readonly string[];
  campaignIds: readonly string[];
  creativeIds: readonly string[];
  priorityCodes: readonly MetricsPriorityCode[];
  productIds: readonly string[];
  pipelineIds?: readonly string[];
  stageIds?: readonly string[];
  channels?: readonly string[];
  municipality?: readonly string[];
  stateCodes?: readonly string[];
  politicalRoles?: readonly string[];
  cadenceStepKeys?: readonly string[];
  executionModes?: readonly ("MANUAL" | "AUTOMATION" | "SYSTEM")[];
}>;

export type CanonicalMetricState =
  | "AVAILABLE"
  | "ZERO"
  | "NO_DENOMINATOR"
  | "UNAVAILABLE"
  | "NOT_APPLICABLE"
  | "PARTIAL"
  | "SUPPRESSED"
  | "DELAYED";

export type CanonicalMetricValue = Readonly<{
  metricId: string;
  definitionVersion: number;
  state: CanonicalMetricState;
  value: string | number | null;
  unit: "COUNT" | "CENTS" | "BASIS_POINTS" | "SECONDS";
  numerator: string | number | null;
  denominator: string | number | null;
  sampleCount: number | null;
  coverageBasisPoints: number | null;
  period: Readonly<{ from: string; to: string; timeZone: string; interval: "HALF_OPEN" }>;
  asOf: string;
  filters: MetricsFilters;
  scope: "WORKSPACE" | "TEAM" | "OWN";
  freshnessAt: string | null;
  reason: string;
  limitations: readonly string[];
  drilldownId: string | null;
}>;

export type IntegratedMetricsOverview = Readonly<{
  registryVersion: string;
  generatedAt: string;
  values: readonly CanonicalMetricValue[];
  quality: Readonly<{
    totalFacts: number;
    unattributedFacts: number;
    coverageBasisPoints: number | null;
    freshnessAt: string | null;
    reconciliationState: CanonicalMetricState;
    reconciliationRunId: string | null;
    reconciliationExpectedCount: number | null;
    reconciliationActualCount: number | null;
    divergentCheckCount: number | null;
    reason: string;
  }>;
}>;

export type IntegratedActivityFact = Readonly<{
  id: string;
  eventType: string;
  sourceEntityType: string;
  occurredAt: string;
  leadId: string | null;
  creditedMemberId: string | null;
  performedByMemberId: string | null;
  bookedByMemberId: string | null;
  taskKind: string | null;
  result: string | null;
  cadenceStepKey: string | null;
  quantity: number;
  valueCents: string | null;
}>;

export type MetricsQuery = Readonly<{
  from: string;
  to: string;
  filters: MetricsFilters;
}>;

export type CountMetric = Readonly<{
  value: number;
  numerator: number;
  denominator: null;
}>;

export type RateMetric = Readonly<{
  numerator: number;
  denominator: number;
  basisPoints: number | null;
  percentage: number | null;
}>;

export type DurationStatistics = Readonly<{
  sampleCount: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
  p90Seconds: number | null;
  minimumSeconds: number | null;
  maximumSeconds: number | null;
}>;

export type SlaStatistics = DurationStatistics &
  Readonly<{
    upTo60Seconds: number;
    upTo180Seconds: number;
    missingCount: number;
  }>;

export type MoneyMetric = Readonly<{
  cents: string;
  numerator: number;
  denominator: null;
  currency: "BRL";
}>;

export type AverageMoneyMetric = Readonly<{
  cents: string | null;
  numeratorCents: string;
  denominator: number;
  currency: "BRL";
}>;

export type StageDurationMetric = Readonly<{
  pipelineId: string;
  pipelineName: string;
  entityType: "LEAD" | "OPPORTUNITY";
  stageId: string;
  stageName: string;
  statistics: DurationStatistics;
}>;

export type AgingMetric = Readonly<{
  overall: DurationStatistics;
  byStage: readonly StageDurationMetric[];
}>;

export type MetricsOverviewEvidence = Readonly<{
  universeLeadIds: readonly string[];
  leadsReceivedLeadIds: readonly string[];
  leadReceipts: readonly Readonly<{
    submissionId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  attemptedLeadIds: readonly string[];
  firstAttempts: readonly Readonly<{
    cycleId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  contactedLeadIds: readonly string[];
  firstConnections: readonly Readonly<{
    cycleId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  qualifiedLeadIds: readonly string[];
  qualifications: readonly Readonly<{
    historyId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  scheduledLeadIds: readonly string[];
  scheduledMeetings: readonly Readonly<{
    meetingId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  heldMeetings: readonly Readonly<{ meetingId: string; leadId: string; occurredAt: string }>[];
  noShowMeetings: readonly Readonly<{ meetingId: string; leadId: string; occurredAt: string }>[];
  opportunitiesCreated: readonly Readonly<{
    opportunityId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  proposals: readonly Readonly<{
    historyId: string;
    opportunityId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  periodWins: readonly Readonly<{
    snapshotId: string;
    opportunityId: string;
    leadId: string;
    occurredAt: string;
    amountCents: string;
    mrrCents: string;
    tcvCents: string;
  }>[];
  periodLosses: readonly Readonly<{
    snapshotId: string;
    opportunityId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  disqualifications: readonly Readonly<{
    historyId: string;
    leadId: string;
    occurredAt: string;
  }>[];
  wonLeadIdsAtCut: readonly string[];
  slaCycles: readonly Readonly<{
    cycleId: string;
    leadId: string;
    receivedAt: string;
    automaticSeconds: number;
    humanSeconds: number | null;
  }>[];
  openLeadIds: readonly string[];
  stalledLeadIds: readonly string[];
  leadsWithoutActivityIds: readonly string[];
  leadsWithoutNextActionIds: readonly string[];
}>;

export type MetricsOverview = Readonly<{
  period: Readonly<{
    from: string;
    to: string;
    interval: "HALF_OPEN";
    timeZone: string;
  }>;
  filters: MetricsFilters;
  scope: "WORKSPACE" | "TEAM" | "OWN";
  generatedAt: string;
  leadsReceived: CountMetric;
  attemptRate: RateMetric;
  contactRate: RateMetric;
  qualificationOverContact: RateMetric;
  totalQualificationRate: RateMetric;
  schedulingRate: RateMetric;
  showRate: RateMetric;
  noShowRate: RateMetric;
  meetingToSaleRate: RateMetric;
  leadToSaleRate: RateMetric;
  automaticSla: SlaStatistics;
  humanSla: SlaStatistics;
  stageTime: readonly StageDurationMetric[];
  aging: AgingMetric;
  revenue: MoneyMetric;
  mrr: MoneyMetric;
  tcv: MoneyMetric;
  averageTicket: AverageMoneyMetric;
  backlog: CountMetric;
  stalledLeads: CountMetric;
  leadsWithoutActivity: CountMetric;
  leadsWithoutNextAction: CountMetric;
  evidence: MetricsOverviewEvidence;
}>;
