import { advertisingLeadArrivals, advertisingPeriodFacts, type RealtimeActivityFact } from "./realtime-advertising-metrics";
import { summarizeDashboardSellerActivity } from "@/modules/metrics/domain/dashboard-seller-activity";
import { summarizeEffectiveContacts } from "@/modules/metrics/domain/effective-contact-metrics";
import type {
  RealtimeDashboardGoals,
  RealtimeDashboardPeriod,
  RealtimeDashboardRankingRow,
  RealtimeDashboardTotals,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import {
  addLocalDays,
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
  workspaceDayRange,
  workspaceWeekRange,
} from "@/shared/core/time/workspace-time";
import { buildRealtimeDashboardGoals, type RealtimeGoalConfiguration, type RealtimeSeller } from "./realtime-dashboard-goals";
import { buildRealtimeSalesFunnel } from "./realtime-sales-funnel";
import { realtimePeriodLabels, realtimePeriodQuerySchema, type RealtimePeriodSelection } from "./realtime-period-filter";

export const realtimeDashboardEventTypes = Object.freeze([
  "TASK_COMPLETED",
  "CALL_ATTEMPTED",
  "CALL_CONNECTED",
  "INBOUND_MESSAGE_RECEIVED",
  "WHATSAPP_MESSAGE_SENT",
  "INSTAGRAM_MESSAGE_SENT",
  "EMAIL_SENT",
  "MEETING_SCHEDULED",
  "MEETING_COMPLETED",
  "SALE_WON",
] as const);

export type RealtimeDashboardPeriods = Readonly<{
  selection?: RealtimePeriodSelection;
  today: RealtimeDashboardPeriod;
  week: RealtimeDashboardPeriod;
  queryFrom: Date;
  queryTo: Date;
  weekGoalEnd: Date;
  weekPlanEnd: Date;
}>;

export function resolveRealtimeDashboardPeriods(
  now: Date,
  timeZone: string,
  query: unknown = {},
): RealtimeDashboardPeriods {
  const filter = realtimePeriodQuerySchema.parse(query);
  const todayDate = workspaceDateAt(now, timeZone);
  if (filter.periodPreset !== "TODAY") {
    const anchor = filter.periodPreset === "YESTERDAY" ? addLocalDays(todayDate, -1)
      : filter.periodPreset === "LAST_WEEK" ? addLocalDays(todayDate, -7) : todayDate;
    const week = workspaceWeekRange(anchor, timeZone);
    const fromDate = filter.periodPreset === "CUSTOM" ? filter.periodFrom : filter.periodPreset === "YESTERDAY" ? anchor : week.startDate;
    const toDate = filter.periodPreset === "CUSTOM" ? filter.periodTo : filter.periodPreset === "YESTERDAY" ? anchor : week.endDate;
    const start = workspaceDayRange(fromDate, timeZone).start;
    const end = workspaceDayRange(toDate, timeZone).end;
    const to = filter.periodPreset === "THIS_WEEK" && now < end ? now : end;
    const period = { from: start.toISOString(), to: to.toISOString(), fromDate, toDate, timeZone, interval: "HALF_OPEN" as const };
    return {
      selection: { preset: filter.periodPreset, label: realtimePeriodLabels[filter.periodPreset] },
      today: period, week: period, queryFrom: start, queryTo: to, weekGoalEnd: end, weekPlanEnd: end,
    };
  }
  const todayRange = workspaceDayRange(todayDate, timeZone);
  const weekRange = workspaceWeekRange(todayDate, timeZone);
  const saturdayDate = addLocalDays(weekRange.startDate, 5);
  const saturdayStart = parseWorkspaceLocalDateTime(`${saturdayDate}T00:00`, timeZone);
  const weekTo = now < saturdayStart ? now : saturdayStart;
  const weekToDate = workspaceDateAt(new Date(Math.max(weekRange.start.getTime(), weekTo.getTime() - 1)), timeZone);

  return Object.freeze({
    today: Object.freeze({
      from: todayRange.start.toISOString(),
      to: now.toISOString(),
      fromDate: todayDate,
      toDate: todayDate,
      timeZone,
      interval: "HALF_OPEN" as const,
    }),
    week: Object.freeze({
      from: weekRange.start.toISOString(),
      to: weekTo.toISOString(),
      fromDate: weekRange.startDate,
      toDate: weekToDate,
      timeZone,
      interval: "HALF_OPEN" as const,
    }),
    queryFrom: weekRange.start,
    queryTo: now,
    weekGoalEnd: saturdayStart,
    weekPlanEnd: weekRange.end,
  });
}

export function initialsForRealtimeDashboard(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("") || "?";
}

function factsWithin(
  facts: readonly RealtimeActivityFact[],
  period: Pick<RealtimeDashboardPeriod, "from" | "to">,
): readonly RealtimeActivityFact[] {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  return facts.filter((fact) => {
    const occurredAt = Date.parse(fact.occurredAt);
    return occurredAt >= from && occurredAt < to;
  });
}

export function summarizeRealtimeDashboardTotals(
  facts: readonly RealtimeActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
): RealtimeDashboardTotals {
  const known = new Set(sellers.map((seller) => seller.id));
  const unattributedId = "realtime-unattributed";
  const rows = summarizeDashboardSellerActivity(facts.map((fact) => {
    const memberId = fact.eventType === "MEETING_SCHEDULED" ? fact.bookedByMemberId ?? fact.creditedMemberId : fact.creditedMemberId;
    return memberId && known.has(memberId) ? fact : { ...fact, creditedMemberId: unattributedId, bookedByMemberId: fact.eventType === "MEETING_SCHEDULED" ? unattributedId : fact.bookedByMemberId };
  }), [...sellers, { id: unattributedId, name: "Sem atribuição" }]);
  return Object.freeze({
    tasksCompleted: rows.reduce((total, row) => total + row.tasksCompleted, 0),
    calls: rows.reduce((total, row) => total + row.calls, 0),
    effectiveContacts: summarizeEffectiveContacts(facts).total,
    messages: rows.reduce(
      (total, row) => total + row.whatsappMessages + row.instagramMessages,
      0,
    ),
    meetingsScheduled: rows.reduce((total, row) => total + row.meetingsBooked, 0),
    meetingsCompleted: rows.reduce((total, row) => total + row.meetingsCompleted, 0),
    sales: rows.reduce((total, row) => total + row.sales, 0),
    salesValueCents: rows.reduce((total, row) => total + BigInt(row.salesValueCents), 0n).toString(),
  });
}

function rankedSellerActivity(
  facts: readonly RealtimeActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
) {
  return summarizeDashboardSellerActivity(facts, sellers)
    .map((row) => ({
      ...row,
      messages: row.whatsappMessages + row.instagramMessages,
      actions: row.calls + row.whatsappMessages + row.instagramMessages + row.emailsSent
        + row.meetingsBooked + row.meetingsCompleted,
    }))
    .sort((left, right) => right.meetingsBooked - left.meetingsBooked
      || left.name.localeCompare(right.name, "pt-BR")
      || left.id.localeCompare(right.id));
}

export function buildRealtimeDashboardRanking(
  facts: readonly RealtimeActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
): readonly Omit<RealtimeDashboardRankingRow, "today" | "goals">[] {
  const rows = rankedSellerActivity(facts, sellers);

  return Object.freeze(rows.map((row, index) => Object.freeze({
    position: index + 1,
    name: row.name,
    initials: initialsForRealtimeDashboard(row.name),
    actions: row.actions,
    calls: row.calls,
    messages: row.messages,
    effectiveContacts: row.effectiveContacts,
    meetingsScheduled: row.meetingsBooked,
    meetingsCompleted: row.meetingsCompleted,
    sales: row.sales,
    salesValueCents: row.salesValueCents,
    tasksCompleted: row.tasksCompleted,
  })));
}

export function aggregateRealtimeDashboard(
  facts: readonly RealtimeActivityFact[],
  sellers: readonly RealtimeSeller[],
  periods: RealtimeDashboardPeriods,
  configuration: RealtimeGoalConfiguration = { profiles: [], quotas: [] },
) {
  const advertising = configuration.front === "ADVERTISING";
  const periodFacts = (rows: readonly RealtimeActivityFact[]) => advertising ? advertisingPeriodFacts(rows) : rows;
  const todayFacts = periodFacts(factsWithin(facts, periods.today));
  const weekFacts = periodFacts(factsWithin(facts, periods.week));
  const todayLeads = advertising ? advertisingLeadArrivals(todayFacts).size : undefined;
  const weekLeads = advertising ? advertisingLeadArrivals(weekFacts).size : undefined;
  const weekTotals = summarizeRealtimeDashboardTotals(weekFacts, sellers);
  const goals = buildRealtimeDashboardGoals({ sellers, todayFacts, weekFacts, weekFromDate: periods.week.fromDate, timeZone: periods.week.timeZone, configuration });
  const filtered = Boolean(periods.selection);
  // Historical filters report results without projecting today's goal settings
  // onto a past day or an arbitrary interval.
  const periodGoals = (value: RealtimeDashboardGoals): RealtimeDashboardGoals => filtered
    ? Object.fromEntries(Object.entries(value).map(([key, goal]) => [key, { ...goal, targetValue: null, progressBasisPoints: null, source: null, label: "Metas disponíveis na visão Hoje" }])) as RealtimeDashboardGoals : value;
  // Visibility only affects individual rows, never the team's facts or targets.
  const rankingSellers = sellers.filter((seller) => seller.rankingVisible !== false);
  const dailyRows = new Map(rankedSellerActivity(todayFacts, rankingSellers).map((row) => [row.id, Object.freeze({ calls: row.calls, messages: row.messages, effectiveContacts: row.effectiveContacts, meetingsScheduled: row.meetingsBooked, meetingsCompleted: row.meetingsCompleted, sales: row.sales, salesValueCents: row.salesValueCents, tasksCompleted: row.tasksCompleted })]));
  const orderedMembers = rankedSellerActivity(weekFacts, rankingSellers);
  const weeklyRows = buildRealtimeDashboardRanking(weekFacts, rankingSellers);
  return Object.freeze({
    today: Object.freeze({
      period: periods.today,
      ...(advertising ? { leadsReceived: todayLeads! } : {}),
      totals: summarizeRealtimeDashboardTotals(todayFacts, sellers),
      goals: periodGoals(goals.today),
    }),
    week: Object.freeze({
      period: periods.week,
      ...(advertising ? { leadsReceived: weekLeads! } : {}),
      endsAt: periods.weekGoalEnd.toISOString(),
      daily: Object.freeze(Array.from({ length: filtered ? Math.round((Date.parse(periods.week.toDate) - Date.parse(periods.week.fromDate)) / 86_400_000) + 1 : 5 }, (_, index) => {
        const date = addLocalDays(periods.week.fromDate, index);
        const range = workspaceDayRange(date, periods.week.timeZone);
        const to = new Date(Math.min(range.end.getTime(), Date.parse(periods.week.to)));
        return Object.freeze({
          date,
          future: range.start.getTime() >= Date.parse(periods.today.to),
          totals: summarizeRealtimeDashboardTotals(periodFacts(factsWithin(facts, {
            from: range.start.toISOString(),
            to: to.toISOString(),
          })), sellers),
        });
      })),
      totals: weekTotals,
      funnel: buildRealtimeSalesFunnel(weekFacts, weekTotals, weekLeads),
      goals: periodGoals(goals.week),
      ranking: Object.freeze(weeklyRows.map((row, index) => {
        const memberId = orderedMembers[index]!.id;
        const role = sellers.find(seller => seller.id === memberId)?.advertisingRole;
        const memberGoals = goals.byMember.get(memberId)!;
        return { ...row, today: dailyRows.get(memberId)!, goals: { today: periodGoals(memberGoals.today), week: periodGoals(memberGoals.week) }, ...(advertising && role ? { advertisingRole: role } : {}) };
      }).sort((left, right) => {
        if (advertising) {
          const leftMetric = left.advertisingRole === "CLOSER" ? "meetingsCompleted" : "meetingsScheduled";
          const rightMetric = right.advertisingRole === "CLOSER" ? "meetingsCompleted" : "meetingsScheduled";
          if (filtered) return right.today[rightMetric] - left.today[leftMetric] || left.name.localeCompare(right.name, "pt-BR");
          return (right.goals.today[rightMetric].progressBasisPoints ?? -1) - (left.goals.today[leftMetric].progressBasisPoints ?? -1)
            || right.today[rightMetric] - left.today[leftMetric]
            || (right.goals.week[rightMetric].progressBasisPoints ?? -1) - (left.goals.week[leftMetric].progressBasisPoints ?? -1)
            || left.name.localeCompare(right.name, "pt-BR");
        }
        return right.today.meetingsScheduled - left.today.meetingsScheduled
          || right.meetingsScheduled - left.meetingsScheduled
          || left.name.localeCompare(right.name, "pt-BR")
          || left.position - right.position;
      })
        .map((row, index) => Object.freeze({ ...row, position: index + 1 }))),
    }),
  });
}

export function weeklySalesGoal(
  achieved: number,
  targetValue: bigint | null,
  targetLabel: string | null,
) {
  if (targetValue === null) {
    return Object.freeze({
      target: null,
      achieved,
      progressBasisPoints: null,
      label: "Meta semanal não configurada",
    });
  }
  const target = targetValue.toString();
  const progressBasisPoints = targetValue <= 0n
    ? achieved > 0 ? 10_000 : 0
    : Number((BigInt(achieved) * 10_000n) / targetValue);
  return Object.freeze({
    target,
    achieved,
    progressBasisPoints,
    label: targetLabel || "Vendas da semana",
  });
}
