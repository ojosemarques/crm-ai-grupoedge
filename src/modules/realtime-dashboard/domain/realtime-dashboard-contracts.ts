export type RealtimeDashboardTotals = Readonly<{
  tasksCompleted: number;
  calls: number;
  effectiveContacts: number;
  messages: number;
  meetingsScheduled: number;
  meetingsCompleted: number;
  sales: number;
  salesValueCents: string;
}>;

export type RealtimeGoalMetric = Exclude<keyof RealtimeDashboardTotals, "tasksCompleted">;
export type RealtimeGoalProgress = Readonly<{
  actualValue: string;
  targetValue: string | null;
  progressBasisPoints: number | null;
  coveredMembers: number;
  totalMembers: number;
  source: "DAILY_PROFILE" | "DAILY_PROFILE_X5" | "WEEKLY_PLAN" | null;
  label: string;
}>;
export type RealtimeDashboardGoals = Readonly<Record<RealtimeGoalMetric, RealtimeGoalProgress>>;

export type RealtimeDashboardPeriod = Readonly<{
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
  timeZone: string;
  interval: "HALF_OPEN";
}>;

export type RealtimeDashboardRankingRow = Readonly<{
  position: number;
  name: string;
  initials: string;
  actions: number;
  calls: number;
  messages: number;
  effectiveContacts: number;
  meetingsScheduled: number;
  meetingsCompleted: number;
  sales: number;
  salesValueCents: string;
  tasksCompleted: number;
  today: RealtimeDashboardTotals;
  goals: Readonly<{ today: RealtimeDashboardGoals; week: RealtimeDashboardGoals }>;
}>;

export type RealtimeDashboardSnapshot = Readonly<{
  workspaceName: string;
  timeZone: string;
  generatedAt: string;
  freshnessAt: string | null;
  quality: Readonly<{
    state: "LIVE" | "PARTIAL" | "UNAVAILABLE";
    reason: string;
  }>;
  today: Readonly<{
    period: RealtimeDashboardPeriod;
    totals: RealtimeDashboardTotals;
    goals: RealtimeDashboardGoals;
  }>;
  week: Readonly<{
    period: RealtimeDashboardPeriod;
    endsAt: string;
    daily: readonly Readonly<{ date: string; totals: RealtimeDashboardTotals; future: boolean }>[];
    totals: RealtimeDashboardTotals;
    goals: RealtimeDashboardGoals;
    salesGoal: Readonly<{
      target: string | null;
      achieved: number;
      progressBasisPoints: number | null;
      label: string;
    }>;
    ranking: readonly RealtimeDashboardRankingRow[];
  }>;
}>;

export type RealtimeShareState = Readonly<{
  active: boolean;
  revision: number | null;
  createdAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
}>;

export type RealtimeDashboardScreen = Readonly<{
  snapshot: RealtimeDashboardSnapshot;
  sharing: RealtimeShareState;
  permissions: Readonly<{ manageShare: boolean }>;
}>;
