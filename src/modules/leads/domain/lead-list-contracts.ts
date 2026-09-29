export const leadListColumnKeys = [
  "name",
  "jobTitle",
  "priority",
  "score",
  "reason",
  "responsible",
  "source",
  "campaign",
  "creative",
  "stage",
  "status",
  "sla",
  "age",
  "lastActivity",
  "nextAction",
  "location",
  "capacity",
  "decisionMaker",
] as const;

export type LeadListColumnKey = (typeof leadListColumnKeys)[number];

export const defaultLeadListColumns = [
  "name",
  "jobTitle",
  "priority",
  "score",
  "reason",
  "responsible",
  "source",
  "stage",
  "sla",
  "age",
  "lastActivity",
  "nextAction",
] as const satisfies readonly LeadListColumnKey[];

export type LeadListQuery = Readonly<{
  q: string;
  page: number;
  pageSize: number;
  responsibles: readonly string[];
  teams: readonly string[];
  priorities: readonly ("P1" | "P2" | "P3")[];
  scoreMin: number | null;
  scoreMax: number | null;
  stages: readonly string[];
  statuses: readonly ("OPEN" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED" | "LOST")[];
  sla: "ALL" | "HEALTHY" | "ATTENTION" | "CRITICAL" | "WITH_ATTEMPT" | "WITHOUT_ATTEMPT";
  sources: readonly string[];
  campaigns: readonly string[];
  creatives: readonly string[];
  jobTitle: string;
  state: string;
  city: string;
  pain: string;
  capacity: "ALL" | "UNKNOWN" | "KNOWN" | "UP_TO_5000" | "FROM_5000_TO_10000" | "ABOVE_10000";
  decisionMaker: "ALL" | "UNKNOWN" | "NEGATIVE" | "PARTIAL" | "POSITIVE";
  enteredFrom: string;
  enteredTo: string;
  lastActivityFrom: string;
  lastActivityTo: string;
  nextAction: "ALL" | "OVERDUE" | "TODAY" | "FUTURE" | "MISSING";
  nextActionFrom: string;
  nextActionTo: string;
  disqualificationReasons: readonly string[];
  lossReasons: readonly string[];
  operationalBucket: "ALL" | "NOW" | "NEW" | "P1" | "WAITING_CALL" | "RESPONDED" | "RETURN_TODAY" | "OVERDUE" | "MEETINGS_TODAY" | "MISSING_NEXT_ACTION";
  sort: "operational" | "name" | "priority" | "score" | "responsible" | "source" | "stage" | "sla" | "receivedAt" | "lastActivity" | "nextAction";
  direction: "asc" | "desc";
  columns: readonly LeadListColumnKey[];
}>;

export type LeadListRow = Readonly<{
  id: string;
  fullName: string;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  city: string | null;
  stateCode: string | null;
  interestSummary: string | null;
  budgetCents: string | null;
  status: string;
  priorityCode: string | null;
  score: number | null;
  priorityReason: string | null;
  responsibleId: string;
  responsibleName: string;
  responsibleType: "MEMBER" | "QUEUE";
  teamName: string | null;
  sourceId: string;
  sourceName: string;
  campaignId: string | null;
  campaignName: string | null;
  creativeId: string | null;
  creativeName: string | null;
  stageId: string;
  stageName: string;
  slaSeconds: number | null;
  slaBand: "HEALTHY" | "ATTENTION" | "CRITICAL" | "UNKNOWN";
  firstHumanAttemptAt: string | null;
  awaitingHumanResponse: boolean;
  receivedAt: string;
  lastActivityAt: string;
  lastActivitySubject: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  decisionMakerStatus: string | null;
  disqualificationReason: string | null;
  lossReason: string | null;
}>;

export type SavedLeadView = Readonly<{
  id: string;
  name: string;
  query: LeadListQuery;
}>;

export type LeadListScreen = Readonly<{
  query: LeadListQuery;
  list: Readonly<{
    rows: readonly LeadListRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    visibleTotal: number;
    hasActiveFilters: boolean;
    generatedAt: string;
  }>;
  filters: Readonly<{
    timeZone: string;
    responsibles: readonly Readonly<{ value: string; label: string }>[];
    assignmentTargets: readonly Readonly<{ id: string; name: string }>[];
    teams: readonly Readonly<{ id: string; name: string }>[];
    priorities: readonly Readonly<{ code: string; name: string }>[];
    stages: readonly Readonly<{ id: string; name: string }>[];
    sources: readonly Readonly<{ id: string; name: string }>[];
    campaigns: readonly Readonly<{ id: string; name: string }>[];
    creatives: readonly Readonly<{ id: string; name: string; campaignId: string }>[];
    jobTitles: readonly string[];
    states: readonly string[];
    cities: readonly string[];
    disqualificationReasons: readonly Readonly<{ id: string; name: string }>[];
    lossReasons: readonly Readonly<{ id: string; name: string }>[];
  }>;
  savedViews: readonly SavedLeadView[];
  canBulkAssign: boolean;
}>;
