import type { DashboardQuery, DashboardSegment } from "@/modules/metrics/domain/dashboard-contracts";

export type TeamManagementPerson = Readonly<{
  id: string;
  name: string;
  roles: readonly ("SDR" | "CLOSER")[];
  contacts: number;
  meetings: number;
  averageFirstResponseSeconds: number | null;
  sdrConversionPercentage: number | null;
  sellerConversionPercentage: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  taskCompletionPercentage: number | null;
  leadsWithoutNextAction: number;
  forgottenLeads: number;
  workedQueueCorrectly: boolean;
}>;

export type TeamCoachingSuggestion = Readonly<{
  memberId: string;
  memberName: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  reason: string;
  action: string;
}>;

export type TeamLeadAlert = Readonly<{
  id: string;
  name: string;
  ownerName: string;
  kind: "WITHOUT_NEXT_ACTION" | "FORGOTTEN";
  href: string;
}>;

export type TeamManagementScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  query: DashboardQuery;
  people: readonly TeamManagementPerson[];
  coaching: readonly TeamCoachingSuggestion[];
  leadAlerts: readonly TeamLeadAlert[];
  lossReasons: readonly DashboardSegment[];
  summary: Readonly<{
    people: number;
    workingQueueCorrectly: number;
    leadsWithoutNextAction: number;
    forgottenLeads: number;
    contacts: number;
    meetings: number;
  }>;
  definitions: readonly Readonly<{ label: string; formula: string }>[];
}>;
