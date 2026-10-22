export type RealtimeDashboardTotals = Readonly<{
  calls: number;
  effectiveContacts: number;
  messages: number;
  meetingsScheduled: number;
  meetingsCompleted: number;
  sales: number;
  salesValueCents: string;
}>;

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
  }>;
  week: Readonly<{
    period: RealtimeDashboardPeriod;
    totals: RealtimeDashboardTotals;
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
