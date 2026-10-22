import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { summarizeDashboardSellerActivity } from "@/modules/metrics/domain/dashboard-seller-activity";
import { summarizeEffectiveContacts } from "@/modules/metrics/domain/effective-contact-metrics";
import type {
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

export const realtimeDashboardEventTypes = Object.freeze([
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
  today: RealtimeDashboardPeriod;
  week: RealtimeDashboardPeriod;
  queryFrom: Date;
  queryTo: Date;
  weekGoalEnd: Date;
}>;

export function resolveRealtimeDashboardPeriods(
  now: Date,
  timeZone: string,
): RealtimeDashboardPeriods {
  const todayDate = workspaceDateAt(now, timeZone);
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
  facts: readonly IntegratedActivityFact[],
  period: Pick<RealtimeDashboardPeriod, "from" | "to">,
): readonly IntegratedActivityFact[] {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  return facts.filter((fact) => {
    const occurredAt = Date.parse(fact.occurredAt);
    return occurredAt >= from && occurredAt < to;
  });
}

export function summarizeRealtimeDashboardTotals(
  facts: readonly IntegratedActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
): RealtimeDashboardTotals {
  const rows = summarizeDashboardSellerActivity(facts, sellers);
  return Object.freeze({
    calls: rows.reduce((total, row) => total + row.calls, 0),
    effectiveContacts: summarizeEffectiveContacts(facts).total,
    messages: rows.reduce(
      (total, row) => total + row.whatsappMessages + row.instagramMessages + row.emailsSent,
      0,
    ),
    meetingsScheduled: rows.reduce((total, row) => total + row.meetingsBooked, 0),
    meetingsCompleted: rows.reduce((total, row) => total + row.meetingsCompleted, 0),
    sales: rows.reduce((total, row) => total + row.sales, 0),
    salesValueCents: rows.reduce((total, row) => total + BigInt(row.salesValueCents), 0n).toString(),
  });
}

export function buildRealtimeDashboardRanking(
  facts: readonly IntegratedActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
): readonly RealtimeDashboardRankingRow[] {
  const rows = summarizeDashboardSellerActivity(facts, sellers)
    .map((row) => ({
      ...row,
      messages: row.whatsappMessages + row.instagramMessages + row.emailsSent,
      actions: row.calls + row.whatsappMessages + row.instagramMessages + row.emailsSent
        + row.meetingsBooked + row.meetingsCompleted,
    }))
    .sort((left, right) => right.actions - left.actions
      || right.effectiveContacts - left.effectiveContacts
      || right.meetingsCompleted - left.meetingsCompleted
      || right.sales - left.sales
      || left.name.localeCompare(right.name, "pt-BR"));

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
  })));
}

export function aggregateRealtimeDashboard(
  facts: readonly IntegratedActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
  periods: RealtimeDashboardPeriods,
) {
  const todayFacts = factsWithin(facts, periods.today);
  const weekFacts = factsWithin(facts, periods.week);
  return Object.freeze({
    today: Object.freeze({
      period: periods.today,
      totals: summarizeRealtimeDashboardTotals(todayFacts, sellers),
    }),
    week: Object.freeze({
      period: periods.week,
      endsAt: periods.weekGoalEnd.toISOString(),
      daily: Object.freeze(Array.from({ length: 5 }, (_, index) => {
        const date = addLocalDays(periods.week.fromDate, index);
        const range = workspaceDayRange(date, periods.week.timeZone);
        const to = new Date(Math.min(range.end.getTime(), Date.parse(periods.week.to)));
        return Object.freeze({
          date,
          future: range.start.getTime() >= Date.parse(periods.today.to),
          totals: summarizeRealtimeDashboardTotals(factsWithin(weekFacts, {
            from: range.start.toISOString(),
            to: to.toISOString(),
          }), sellers),
        });
      })),
      totals: summarizeRealtimeDashboardTotals(weekFacts, sellers),
      ranking: buildRealtimeDashboardRanking(weekFacts, sellers),
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
