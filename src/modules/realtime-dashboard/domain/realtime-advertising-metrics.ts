import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";

export type RealtimeActivityFact = IntegratedActivityFact & Readonly<{
  meetingId?: string | null;
  meetingOwnerMemberIdAtEvent?: string | null;
}>;

const entryEvents = new Set(["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"]);
const outreachEvents = new Set(["CALL_ATTEMPTED", "CALL_CONNECTED", "INBOUND_MESSAGE_RECEIVED", "WHATSAPP_MESSAGE_SENT", "INSTAGRAM_MESSAGE_SENT", "EMAIL_SENT"]);

export function advertisingLeadArrivals(facts: readonly RealtimeActivityFact[]): ReadonlyMap<string, string> {
  const balances = new Map<string, { leadId: string; occurredAt: string; quantity: number }>();
  for (const fact of facts) {
    if (!fact.leadId || !entryEvents.has(fact.eventType)) continue;
    const key = `${fact.eventType}:${fact.leadId}:${fact.occurredAt}`;
    balances.set(key, { leadId: fact.leadId, occurredAt: fact.occurredAt, quantity: (balances.get(key)?.quantity ?? 0) + fact.quantity });
  }
  const arrivals = new Map<string, string>();
  for (const fact of balances.values()) {
    if (fact.quantity > 0 && (!arrivals.has(fact.leadId) || fact.occurredAt < arrivals.get(fact.leadId)!)) arrivals.set(fact.leadId, fact.occurredAt);
  }
  return arrivals;
}

export function advertisingPeriodFacts(facts: readonly RealtimeActivityFact[]): readonly RealtimeActivityFact[] {
  const arrivals = advertisingLeadArrivals(facts);
  // An inbound-only message does not mean pre-sales contacted the new lead.
  return facts.filter(fact => fact.eventType !== "INBOUND_MESSAGE_RECEIVED" && (!outreachEvents.has(fact.eventType)
    || Boolean(fact.leadId && arrivals.has(fact.leadId) && fact.occurredAt >= arrivals.get(fact.leadId)!)));
}

export function advertisingAssignedMeetings(facts: readonly RealtimeActivityFact[], memberId: string): number {
  const balances = new Map<string, { quantity: number; identified: boolean }>();
  for (const fact of facts) {
    if (fact.eventType !== "MEETING_SCHEDULED" || fact.meetingOwnerMemberIdAtEvent !== memberId) continue;
    const key = fact.meetingId ?? `${fact.leadId ?? fact.id}:${fact.occurredAt}`;
    balances.set(key, { quantity: (balances.get(key)?.quantity ?? 0) + fact.quantity, identified: Boolean(fact.meetingId) });
  }
  return [...balances.values()].reduce((sum, row) => sum + (row.quantity > 0 ? row.identified ? 1 : row.quantity : 0), 0);
}
