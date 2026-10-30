export type MeetingBookingFact = Readonly<{
  id: string;
  occurredAt: Date;
  quantity: number;
  correctionOfFactId: string | null;
  leadId: string | null;
  contactId: string | null;
  meetingId: string | null;
  lead: { contactId: string | null } | null;
}>;

/** Keep the first valid booking per person, after applying ledger corrections. */
export function firstMeetingBookingIds(facts: readonly MeetingBookingFact[]): ReadonlySet<string> {
  const corrections = new Map<string, number>();
  for (const fact of facts) {
    if (fact.correctionOfFactId) corrections.set(fact.correctionOfFactId, (corrections.get(fact.correctionOfFactId) ?? 0) + fact.quantity);
  }
  const people = new Set<string>();
  const first = new Set<string>();
  for (const fact of [...facts].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))) {
    if (fact.quantity <= 0 || fact.quantity + (corrections.get(fact.id) ?? 0) <= 0) continue;
    const contact = fact.lead?.contactId ?? fact.contactId;
    const person = contact ? `contact:${contact}` : fact.leadId ? `lead:${fact.leadId}` : fact.meetingId ? `meeting:${fact.meetingId}` : `fact:${fact.id}`;
    if (people.has(person)) continue;
    people.add(person);
    first.add(fact.id);
  }
  return first;
}
