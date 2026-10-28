import { durationStatistics } from "./metric-math";

export type FrontSummaryFact = Readonly<{
  id: string; eventType: string; leadId: string | null; contactId: string | null;
  pipelineId: string | null; meetingId: string | null; sourceEntityType: string;
  bookedByMemberId: string | null; creditedMemberId: string | null; meetingOwnerMemberIdAtEvent: string | null;
  entryOutcome: "CREATED" | "ATTACHED" | "REJECTED" | null; occurredAt: string; identityConfirmed: boolean; quantity: number; valueCents: string | null; correctionOfFactId: string | null;
}>;

export function positiveCommercialFrontFacts<T extends FrontSummaryFact>(facts: readonly T[]): T[] {
  const key = (fact: T) => JSON.stringify([fact.eventType, fact.leadId, fact.meetingId, fact.bookedByMemberId, fact.creditedMemberId, fact.meetingOwnerMemberIdAtEvent]);
  const balances = new Map<string, number>();
  for (const fact of facts) balances.set(key(fact), (balances.get(key(fact)) ?? 0) + fact.quantity);
  return facts.filter((fact) => fact.quantity > 0 && (balances.get(key(fact)) ?? 0) > 0);
}

function frontTiming(facts: readonly FrontSummaryFact[]) {
  const balances = new Map<string, number>();
  for (const fact of facts) {
    const key = `${fact.eventType}:${fact.leadId}:${fact.occurredAt}`;
    balances.set(key, (balances.get(key) ?? 0) + fact.quantity);
  }
  const positive = facts.filter((fact) => fact.quantity > 0 && fact.leadId && (balances.get(`${fact.eventType}:${fact.leadId}:${fact.occurredAt}`) ?? 0) > 0)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const entries = new Map<string, FrontSummaryFact>();
  for (const fact of positive) if (["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"].includes(fact.eventType) && !entries.has(fact.leadId!)) entries.set(fact.leadId!, fact);
  const definitions = [
    { id: "time-first-action", label: "Primeira ação observada", types: ["CALL_ATTEMPTED", "EMAIL_SENT", "WHATSAPP_MESSAGE_SENT", "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED"] },
    { id: "time-first-response", label: "Primeira resposta humana", types: ["CALL_CONNECTED", "EMAIL_REPLIED", "INBOUND_MESSAGE_RECEIVED", "HUMAN_RESPONSE_CONFIRMED"] },
    { id: "time-booking", label: "Agendamento", types: ["MEETING_SCHEDULED"] },
    { id: "time-result", label: "Primeiro resultado comercial", types: ["SALE_WON", "OPPORTUNITY_LOST", "LEAD_DISQUALIFIED"] },
  ];
  return definitions.map((definition) => {
    const reached = new Set<string>();
    const samples: { leadId: string; startFactId: string; endFactId: string; startedAt: string; endedAt: string; seconds: number }[] = [];
    for (const fact of positive) {
      const entry = entries.get(fact.leadId!);
      if (!entry || reached.has(fact.leadId!) || !definition.types.includes(fact.eventType) || fact.occurredAt < entry.occurredAt) continue;
      reached.add(fact.leadId!);
      samples.push({ leadId: fact.leadId!, startFactId: entry.id, endFactId: fact.id, startedAt: entry.occurredAt, endedAt: fact.occurredAt, seconds: Math.floor((Date.parse(fact.occurredAt) - Date.parse(entry.occurredAt)) / 1000) });
    }
    return { id: definition.id, label: definition.label, statistics: durationStatistics(samples.map((sample) => sample.seconds)), missingCount: entries.size - samples.length, samples };
  });
}

export function summarizeCommercialFront(facts: readonly FrontSummaryFact[]) {
  const positive = positiveCommercialFrontFacts(facts);
  const sums = (type: string) => facts.filter((fact) => fact.eventType === type).reduce((sum, fact) => sum + fact.quantity, 0);
  const participation = positive.filter((fact) => fact.eventType === "LEAD_CREATED" && fact.quantity > 0);
  const entries = positive.filter((fact) => fact.eventType === "LEAD_SUBMISSION_ATTACHED" && fact.quantity > 0);
  const identities = new Set(participation.map((fact) => fact.contactId && fact.identityConfirmed ? `contact:${fact.contactId}` : `lead:${fact.leadId}`));
  const unresolvedIdentities = new Set(participation.filter((fact) => !fact.identityConfirmed).map((fact) => fact.leadId)).size;
  const bookedLeadIds = new Set(positive.filter((fact) => fact.eventType === "MEETING_SCHEDULED" && fact.quantity > 0).map((fact) => fact.leadId));
  const entryLeads = new Set(entries.map((fact) => fact.leadId));
  const bookingIds = new Set(positive.filter((fact) => fact.eventType === "MEETING_SCHEDULED" && fact.quantity > 0 && fact.meetingId).map((fact) => fact.meetingId));
  const completedIds = new Set(positive.filter((fact) => fact.eventType === "MEETING_COMPLETED" && fact.quantity > 0 && fact.meetingId).map((fact) => fact.meetingId));
  const eligibleBooked = [...bookedLeadIds].filter((id) => id && entryLeads.has(id)).length;
  const eligibleHeld = [...completedIds].filter((id) => bookingIds.has(id)).length;
  const memberIds = new Set(facts.flatMap((fact) => [fact.bookedByMemberId, fact.creditedMemberId, fact.meetingOwnerMemberIdAtEvent].filter((id): id is string => Boolean(id))));
  const members = [...memberIds].map((memberId) => {
    const assigned = new Set(positive.filter((fact) => fact.eventType === "MEETING_SCHEDULED" && fact.meetingOwnerMemberIdAtEvent === memberId && fact.meetingId && fact.quantity > 0).map((fact) => fact.meetingId));
    return {
      memberId,
      booked: facts.filter((fact) => fact.eventType === "MEETING_SCHEDULED" && (fact.bookedByMemberId ?? fact.creditedMemberId) === memberId).reduce((sum, fact) => sum + fact.quantity, 0),
      assigned: assigned.size,
      completed: facts.filter((fact) => fact.eventType === "MEETING_COMPLETED" && fact.creditedMemberId === memberId).reduce((sum, fact) => sum + fact.quantity, 0),
    };
  }).filter((row) => row.booked || row.assigned || row.completed);
  return {
    participations: sums("LEAD_CREATED"), entries: sums("LEAD_SUBMISSION_ATTACHED"), uniquePeople: identities.size,
    unresolvedIdentities, reentries: facts.filter((fact) => fact.eventType === "LEAD_SUBMISSION_ATTACHED" && fact.entryOutcome === "ATTACHED").reduce((sum, fact) => sum + fact.quantity, 0),
    unresolvedEntries: new Set(entries.filter((fact) => !fact.entryOutcome).map((fact) => fact.id)).size,
    booked: sums("MEETING_SCHEDULED"), completed: sums("MEETING_COMPLETED"),
    bookingCohort: { numerator: eligibleBooked, denominator: entryLeads.size, rate: entryLeads.size ? eligibleBooked / entryLeads.size : null },
    completionCohort: { numerator: eligibleHeld, denominator: bookingIds.size, rate: bookingIds.size ? eligibleHeld / bookingIds.size : null },
    members, timing: frontTiming(facts),
  };
}
