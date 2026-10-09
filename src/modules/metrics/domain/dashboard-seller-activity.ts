import type { DashboardSellerActivity } from "@/modules/metrics/domain/dashboard-contracts";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { summarizeEffectiveContacts } from "@/modules/metrics/domain/effective-contact-metrics";
import { countUnresolvedCallAttempts } from "@/modules/metrics/domain/unresolved-call-attempts";

type MutableSellerActivity = { -readonly [K in keyof DashboardSellerActivity]: K extends "salesValueCents" ? bigint : DashboardSellerActivity[K] };

export function summarizeDashboardSellerActivity(
  facts: readonly IntegratedActivityFact[],
  sellers: readonly Readonly<{ id: string; name: string }>[],
): readonly DashboardSellerActivity[] {
  const rows = new Map<string, MutableSellerActivity>();
  const qualifiedBalances = new Map<string, Map<string, number>>();
  const callFactsByMember = new Map<string, IntegratedActivityFact[]>();
  for (const seller of sellers) rows.set(seller.id, {
    ...seller, tasksCompleted: 0, stageEntries: 0, calls: 0, connected: 0, effectiveContacts: 0, unanswered: 0, callbackRequested: 0, whatsappShared: 0,
    noAnswer: 0, busy: 0, voicemail: 0, otherUnanswered: 0, callFailed: 0, wrongNumber: 0, channelUnavailable: 0, otherFailures: 0, withoutOutcome: 0,
    instagramMessages: 0, instagramFollows: 0, emailsSent: 0, instagramMessagesProfileNotFound: 0, instagramMessagesFailed: 0,
    instagramFollowsAlreadyFollowing: 0, instagramFollowsProfileNotFound: 0, instagramFollowsFailed: 0,
    qualified: 0, meetingsScheduled: 0, meetingStageMarked: 0, proposals: 0, sales: 0, salesValueCents: 0n,
  });
  for (const fact of facts) {
    const memberId = fact.eventType === "MEETING_SCHEDULED"
      ? fact.bookedByMemberId ?? fact.creditedMemberId
      : fact.eventType === "STAGE_ENTERED" ? fact.performedByMemberId : fact.creditedMemberId;
    const row = memberId ? rows.get(memberId) : null;
    if (!row) continue;
    if (["CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED"].includes(fact.eventType)) {
      const callFacts = callFactsByMember.get(memberId!) ?? [];
      callFacts.push(fact);
      callFactsByMember.set(memberId!, callFacts);
    }
    const count = fact.quantity;
    switch (fact.eventType) {
      case "TASK_COMPLETED": {
        row.tasksCompleted += count;
        if (fact.taskKind === "INSTAGRAM_MESSAGE") {
          if (fact.result === "PROFILE_NOT_FOUND") row.instagramMessagesProfileNotFound += count;
          else if (fact.result === "FAILED" || fact.result === "CHANNEL_UNAVAILABLE") row.instagramMessagesFailed += count;
        } else if (fact.taskKind === "INSTAGRAM_FOLLOW") {
          if (fact.result === "ALREADY_FOLLOWING") row.instagramFollowsAlreadyFollowing += count;
          else if (fact.result === "PROFILE_NOT_FOUND") row.instagramFollowsProfileNotFound += count;
          else if (fact.result === "FAILED" || fact.result === "CHANNEL_UNAVAILABLE") row.instagramFollowsFailed += count;
        }
        break;
      }
      case "STAGE_ENTERED": row.stageEntries += count; break;
      case "CALL_ATTEMPTED": row.calls += count; break;
      case "CALL_CONNECTED": {
        row.connected += count;
        if (fact.result === "CALLBACK_REQUESTED") row.callbackRequested += count;
        else if (fact.result === "WHATSAPP_SHARED") row.whatsappShared += count;
        break;
      }
      case "CALL_UNANSWERED": {
        row.unanswered += count;
        if (fact.result === "NO_ANSWER") row.noAnswer += count;
        else if (fact.result === "BUSY") row.busy += count;
        else if (fact.result === "VOICEMAIL") row.voicemail += count;
        break;
      }
      case "CALL_FAILED": {
        row.callFailed += count;
        if (fact.result === "WRONG_NUMBER") row.wrongNumber += count;
        else if (fact.result === "CHANNEL_UNAVAILABLE") row.channelUnavailable += count;
        break;
      }
      case "INSTAGRAM_MESSAGE_SENT": row.instagramMessages += count; break;
      case "INSTAGRAM_FOLLOW_COMPLETED": row.instagramFollows += count; break;
      case "EMAIL_SENT": row.emailsSent += count; break;
      case "LEAD_QUALIFIED": {
        if (!fact.leadId) break;
        const balances = qualifiedBalances.get(memberId!) ?? new Map<string, number>();
        balances.set(fact.leadId, (balances.get(fact.leadId) ?? 0) + count);
        qualifiedBalances.set(memberId!, balances);
        break;
      }
      case "MEETING_SCHEDULED": {
        if (fact.sourceEntityType === "MeetingHistory") row.meetingsScheduled += count;
        else if (fact.sourceEntityType === "StageHistory") row.meetingStageMarked += count;
        break;
      }
      case "PROPOSAL_REACHED": {
        if (fact.sourceEntityType === "Offer") row.proposals += count;
        break;
      }
      case "SALE_WON": row.sales += count; row.salesValueCents += BigInt(fact.valueCents ?? "0"); break;
    }
  }
  for (const [memberId, balances] of qualifiedBalances) {
    const row = rows.get(memberId);
    if (row) row.qualified = [...balances.values()].filter((balance) => balance > 0).length;
  }
  const effectiveContacts = summarizeEffectiveContacts(facts).byMember;
  for (const row of rows.values()) {
    row.effectiveContacts = effectiveContacts.get(row.id) ?? 0;
    row.otherUnanswered = Math.max(0, row.unanswered - row.noAnswer - row.busy - row.voicemail);
    row.otherFailures = Math.max(0, row.callFailed - row.wrongNumber - row.channelUnavailable);
    row.withoutOutcome = countUnresolvedCallAttempts(callFactsByMember.get(row.id) ?? []);
  }
  return Object.freeze([...rows.values()]
    .map((row) => Object.freeze({ ...row, salesValueCents: row.salesValueCents.toString() }))
    .sort((left, right) => right.calls - left.calls || right.tasksCompleted - left.tasksCompleted || left.name.localeCompare(right.name, "pt-BR")));
}
