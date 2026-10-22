import { summarizeDashboardSellerActivity } from "@/modules/metrics/domain/dashboard-seller-activity";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import type { RealtimeDashboardGoals, RealtimeGoalMetric, RealtimeGoalProgress } from "./realtime-dashboard-contracts";
import { addLocalDays, workspaceDayRange } from "@/shared/core/time/workspace-time";

export type RealtimeSeller = Readonly<{ id: string; name: string; active?: boolean; rankingVisible?: boolean; functions?: readonly string[]; teamIds?: readonly string[] }>;
export type RealtimeDailyProfile = Readonly<{ memberId: string; callsTarget: number; messagesTarget: number; effectiveContactsTarget: number; meetingsScheduledTarget: number; meetingsCompletedTarget?: number | null; weeklySalesTarget?: number | null; salesValueTargetCents: bigint }>;
export type RealtimeWeeklyQuota = Readonly<{ targetType: string; memberId: string | null; teamId: string | null; function: string | null; metricKey: string; targetValue: bigint }>;
export type RealtimeGoalConfiguration = Readonly<{ profiles: readonly RealtimeDailyProfile[]; quotas: readonly RealtimeWeeklyQuota[]; planName?: string; eligibleMemberIds?: readonly string[] }>;
export const realtimeGoalMetrics: readonly RealtimeGoalMetric[] = ["calls", "messages", "effectiveContacts", "meetingsScheduled", "meetingsCompleted", "sales", "salesValueCents"];

const profileFields = { calls: "callsTarget", messages: "messagesTarget", effectiveContacts: "effectiveContactsTarget", meetingsScheduled: "meetingsScheduledTarget", meetingsCompleted: "meetingsCompletedTarget", salesValueCents: "salesValueTargetCents" } as const;
const quotaMetrics: Partial<Record<RealtimeGoalMetric, string>> = { meetingsCompleted: "MEETINGS_HELD", sales: "OPPORTUNITIES_WON", salesValueCents: "REVENUE_WON_CENTS" };

function actuals(facts: readonly IntegratedActivityFact[], sellers: readonly RealtimeSeller[]) {
  return new Map(summarizeDashboardSellerActivity(facts, sellers).map((row) => [row.id, {
    calls: BigInt(row.calls), messages: BigInt(row.whatsappMessages + row.instagramMessages), effectiveContacts: BigInt(row.effectiveContacts),
    meetingsScheduled: BigInt(row.meetingsBooked), meetingsCompleted: BigInt(row.meetingsCompleted), sales: BigInt(row.sales), salesValueCents: BigInt(row.salesValueCents),
  }]));
}

function progress(actual: bigint, target: bigint | null, coveredMembers: number, totalMembers: number, source: RealtimeGoalProgress["source"], label: string): RealtimeGoalProgress {
  return Object.freeze({ actualValue: actual.toString(), targetValue: target?.toString() ?? null, progressBasisPoints: target !== null && target > 0n ? Number(actual * 10_000n / target) : null, coveredMembers, totalMembers, source, label });
}

export function buildRealtimeDashboardGoals(input: Readonly<{
  sellers: readonly RealtimeSeller[];
  todayFacts: readonly IntegratedActivityFact[];
  weekFacts: readonly IntegratedActivityFact[];
  weekFromDate: string;
  timeZone: string;
  configuration: RealtimeGoalConfiguration;
}>) {
  const eligibleIds = input.configuration.eligibleMemberIds ? new Set(input.configuration.eligibleMemberIds) : null;
  const active = input.sellers.filter((seller) => seller.active !== false && (!eligibleIds || eligibleIds.has(seller.id)));
  const profiles = new Map(input.configuration.profiles.map((profile) => [profile.memberId, profile]));
  const day = actuals(input.todayFacts, input.sellers);
  const week = actuals(input.weekFacts, input.sellers);
  const contactDays = new Map(input.sellers.map((seller) => [seller.id, 0n]));
  for (let index = 0; index < 5; index += 1) {
    const range = workspaceDayRange(addLocalDays(input.weekFromDate, index), input.timeZone);
    const rows = actuals(input.weekFacts.filter((fact) => {
      const at = Date.parse(fact.occurredAt);
      return at >= range.start.getTime() && at < range.end.getTime();
    }), input.sellers);
    for (const seller of input.sellers) contactDays.set(seller.id, contactDays.get(seller.id)! + (rows.get(seller.id)?.effectiveContacts ?? 0n));
  }

  function profileGoal(metric: RealtimeGoalMetric, members: readonly RealtimeSeller[], weekly: boolean): RealtimeGoalProgress {
    const field = profileFields[metric as keyof typeof profileFields];
    const eligible = field ? members.filter((member) => member.active !== false && profiles.has(member.id) && BigInt(profiles.get(member.id)![field] ?? 0) > 0n) : [];
    const target = eligible.length ? eligible.reduce((sum, seller) => sum + BigInt(profiles.get(seller.id)![field!] ?? 0) * (weekly ? 5n : 1n), 0n) : null;
    const achieved = eligible.reduce((sum, seller) => sum + (weekly && metric === "effectiveContacts" ? contactDays.get(seller.id) ?? 0n : (weekly ? week : day).get(seller.id)?.[metric] ?? 0n), 0n);
    const label = metric === "messages" ? weekly ? "Meta WA/IG · diária × 5" : "Meta WA/IG" : metric === "effectiveContacts" && weekly ? "Meta de contatos-dia · diária × 5" : weekly ? "Meta diária × 5" : "Meta diária";
    const expectedMembers = members.filter((member) => member.active !== false && (!field || profiles.get(member.id)?.[field] == null || BigInt(profiles.get(member.id)![field]!) > 0n)).length;
    return progress(achieved, target, eligible.length, expectedMembers, target === null ? null : weekly ? "DAILY_PROFILE_X5" : "DAILY_PROFILE", target === null ? "Sem meta cadastrada" : label);
  }

  function weeklyGoal(metric: RealtimeGoalMetric, members: readonly RealtimeSeller[], individual: boolean): RealtimeGoalProgress {
    if (metric === "sales") {
      const eligible = members.filter((member) => member.active !== false && (profiles.get(member.id)?.weeklySalesTarget ?? 0) > 0);
      if (members.some((member) => member.active !== false && profiles.get(member.id)?.weeklySalesTarget != null)) {
        const target = eligible.reduce((sum, member) => sum + BigInt(profiles.get(member.id)!.weeklySalesTarget!), 0n);
        const achieved = eligible.reduce((sum, member) => sum + (week.get(member.id)?.sales ?? 0n), 0n);
        const expectedMembers = members.filter((member) => member.active !== false && (profiles.get(member.id)?.weeklySalesTarget == null || profiles.get(member.id)!.weeklySalesTarget! > 0)).length;
        return progress(achieved, eligible.length ? target : null, eligible.length, expectedMembers, eligible.length ? "WEEKLY_PROFILE" : null, eligible.length ? "Meta semanal · Meu Dia" : "Sem meta cadastrada");
      }
    }
    if (metric === "meetingsCompleted") {
      const dailyProfile = profileGoal(metric, members, true);
      if (members.some((member) => member.active !== false && profiles.get(member.id)?.meetingsCompletedTarget != null)) return dailyProfile;
    }
    const candidates = input.configuration.quotas.filter((quota) => quota.metricKey === quotaMetrics[metric] && (!individual || quota.targetType === "MEMBER")).map((quota, index) => ({ quota, index, scope: members.filter((member) => member.active !== false && (quota.targetType === "MEMBER" ? quota.memberId === member.id : quota.targetType === "TEAM" ? member.teamIds?.includes(quota.teamId ?? "") : member.functions?.includes(quota.function ?? ""))) })).filter((candidate) => candidate.scope.length > 0);
    if (!candidates.length) return profileGoal(metric, members, true);
    // A collective quota already includes its members; individual targets remain visible on their own rows.
    candidates.sort((left, right) => right.scope.length - left.scope.length || left.index - right.index);
    const covered = new Set<string>();
    let target = 0n;
    let achieved = 0n;
    for (const candidate of candidates) {
      if (candidate.quota.targetValue <= 0n || candidate.scope.some((member) => covered.has(member.id))) continue;
      target += candidate.quota.targetValue;
      for (const member of candidate.scope) { covered.add(member.id); achieved += week.get(member.id)?.[metric] ?? 0n; }
    }
    return progress(achieved, covered.size ? target : null, covered.size, members.filter((member) => member.active !== false).length, covered.size ? "WEEKLY_PLAN" : null, covered.size ? input.configuration.planName ?? "Meta semanal publicada" : "Sem meta ativa");
  }

  function goals(members: readonly RealtimeSeller[], weekly: boolean, individual = false): RealtimeDashboardGoals {
    return Object.freeze(Object.fromEntries(realtimeGoalMetrics.map((metric) => [metric, weekly ? weeklyGoal(metric, members, individual) : profileGoal(metric, members, false)])) as Record<RealtimeGoalMetric, RealtimeGoalProgress>);
  }
  return Object.freeze({
    today: goals(active, false), week: goals(active, true),
    byMember: new Map(input.sellers.map((seller) => [seller.id, Object.freeze({ today: goals([seller], false, true), week: goals([seller], true, true) })])),
  });
}
