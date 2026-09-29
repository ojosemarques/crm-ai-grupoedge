import type {
  DashboardFilterOptions,
  DashboardQuery,
} from "@/modules/metrics/domain/dashboard-contracts";

export const managerQuestionIds = [
  "P1_WITHOUT_ATTEMPT",
  "SDRS_BELOW_AVERAGE",
  "BIGGEST_FUNNEL_LOSS",
  "TOMORROW_MEETINGS_WITHOUT_PACTO",
  "STALLED_OPPORTUNITIES",
  "TOP_SOURCE_QUALIFIED_MEETINGS",
  "LEADS_REQUIRING_ACTION_TODAY",
  "SHOW_RATE_DROP",
] as const;

export type ManagerQuestionId = (typeof managerQuestionIds)[number];

export const managerQuestions: ReadonlyArray<Readonly<{
  id: ManagerQuestionId;
  label: string;
}>> = Object.freeze([
  { id: "P1_WITHOUT_ATTEMPT", label: "Quais leads P1 estão sem tentativa?" },
  { id: "SDRS_BELOW_AVERAGE", label: "Quais SDRs estão abaixo da média?" },
  { id: "BIGGEST_FUNNEL_LOSS", label: "Onde o funil mais perde conversão?" },
  { id: "TOMORROW_MEETINGS_WITHOUT_PACTO", label: "Quais reuniões de amanhã estão sem PACTO completo?" },
  { id: "STALLED_OPPORTUNITIES", label: "Quais oportunidades estão paradas?" },
  { id: "TOP_SOURCE_QUALIFIED_MEETINGS", label: "Qual origem gerou mais reuniões qualificadas?" },
  { id: "LEADS_REQUIRING_ACTION_TODAY", label: "Quais leads precisam de ação hoje?" },
  { id: "SHOW_RATE_DROP", label: "Por que o show rate caiu?" },
]);

export type ManagerAnalyticsNumber = Readonly<{
  label: string;
  value: number | null;
  unit: "COUNT" | "PERCENTAGE" | "DAYS";
  recordGroupId: string;
}>;

export type ManagerAnalyticsRecord = Readonly<{
  key: string;
  entityType: "LEAD" | "MEETING" | "OPPORTUNITY";
  entityId: string;
  leadId: string;
  title: string;
  subtitle: string;
  responsibleName: string | null;
  status: string | null;
  occurredAt: string;
  href: string;
}>;

export type ManagerAnalyticsAnswer = Readonly<{
  questionId: ManagerQuestionId;
  question: string;
  directAnswer: string;
  period: Readonly<{
    from: string;
    to: string;
    fromDate: string;
    toDate: string;
    timeZone: string;
  }>;
  filters: readonly string[];
  scope: "WORKSPACE" | "TEAM";
  formula: string;
  numerator: Readonly<{ label: string; value: number; recordGroupId: string }>;
  denominator: Readonly<{ label: string; value: number; recordGroupId: string }> | null;
  numbers: readonly ManagerAnalyticsNumber[];
  comparison: Readonly<{
    label: string;
    current: number | null;
    previous: number | null;
    delta: number | null;
    unit: "COUNT" | "PERCENTAGE";
  }> | null;
  possibleCauses: readonly string[];
  evidence: readonly string[];
  relatedRecords: readonly ManagerAnalyticsRecord[];
  recordGroups: readonly Readonly<{
    id: string;
    label: string;
    recordKeys: readonly string[];
  }>[];
  recommendedAction: Readonly<{
    title: string;
    reason: string;
    requiresConfirmation: true;
  }>;
  limitations: readonly string[];
  confidence: Readonly<{
    value: number;
    label: "Baixa" | "Média" | "Alta";
    reason: string;
  }>;
}>;

export type ManagerAnalyticsShell = Readonly<{
  query: DashboardQuery;
  timeZone: string;
  filterOptions: DashboardFilterOptions;
  questions: typeof managerQuestions;
}>;
