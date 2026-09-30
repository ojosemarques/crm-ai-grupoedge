export const meetingStatuses = ["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type MeetingStatusValue = (typeof meetingStatuses)[number];

export type MeetingListItem = Readonly<{
  id: string;
  leadId: string;
  opportunityId: string | null;
  leadName: string;
  ownerMemberId: string;
  closerName: string;
  title: string;
  status: MeetingStatusValue;
  operationalStatus: MeetingStatusValue | "PENDING_STATUS";
  startsAt: string;
  endsAt: string;
  durationMinutes: 30 | 40;
  timeZone: string;
  observation: string | null;
  outcome: string | null;
  revision: number;
  canWrite: boolean;
  calendarSync: Readonly<{
    state: "NOT_LINKED" | "PENDING_PUSH" | "PENDING_PULL" | "SYNCED" | "CONFLICT" | "FAILED" | "CANCELLED";
    externalEgress: false;
  }>;
}>;

export type MeetingHistoryItem = Readonly<{
  id: string;
  action: "SCHEDULED" | "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "ATTENDED" | "NO_SHOW";
  previousStatus: MeetingStatusValue | null;
  newStatus: MeetingStatusValue;
  previousStartsAt: string | null;
  newStartsAt: string;
  reason: string | null;
  outcome: string | null;
  occurredAt: string;
  actorName: string;
}>;

export type CloserOption = Readonly<{ id: string; name: string }>;
export type LeadOption = Readonly<{ id: string; name: string; opportunities: readonly Readonly<{ id: string; name: string }>[] }>;

export type AgendaScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  defaultDurationMinutes: 30 | 40;
  view: "day" | "week";
  selectedDate: string;
  rangeLabel: string;
  closerId: string;
  canSchedule: boolean;
  canFilterCloser: boolean;
  closerOptions: readonly CloserOption[];
  leadOptions: readonly LeadOption[];
  meetings: readonly MeetingListItem[];
}>;

export type LeadMeetingsScreen = Readonly<{
  leadId: string;
  timeZone: string;
  defaultDurationMinutes: 30 | 40;
  canSchedule: boolean;
  closerOptions: readonly CloserOption[];
  opportunityOptions: readonly Readonly<{ id: string; name: string }>[];
  meetings: readonly (MeetingListItem & { history: readonly MeetingHistoryItem[] })[];
}>;

export type MeetingBriefing = Readonly<{
  meeting: MeetingListItem;
  summary: string;
  formAnswers: Readonly<{
    interestSummary: string | null;
    jobTitle: string | null;
    organizationName: string | null;
    city: string | null;
    stateCode: string | null;
    budgetCents: number | null;
  }>;
  pacto: readonly Readonly<{
    dimension: string;
    label: string;
    status: string;
    evidence: string | null;
  }>[];
  painInLeadWords: string | null;
  decisionMaker: string | null;
  capacity: string | null;
  urgency: string | null;
  unansweredQuestions: readonly string[];
  recentHistory: readonly Readonly<{ subject: string; description: string | null; occurredAt: string }>[];
  recommendedNextAction: string;
  businessContext: Readonly<{ opportunityId: string | null; opportunityName: string | null; nextAction: Readonly<{ taskId: string; title: string; dueAt: string }> | null }>;
  transcript: Readonly<{ status: "ABSENT" | "AVAILABLE" | "RESTRICTED" | "EXPIRED"; visible: boolean; canManage: boolean; version: number | null; transcriptText: string | null; summary: string | null; policyVersion: string | null; consentRecordedAt: string | null; retentionUntil: string | null }>;
}>;
