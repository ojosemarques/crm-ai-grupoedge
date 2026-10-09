type CallFact = Readonly<{
  eventType: string;
  leadId: string | null;
  quantity: number;
}>;

export function countUnresolvedCallAttempts(facts: readonly CallFact[]): number {
  const byLead = new Map<string, { attempted: number; resolved: number }>();
  for (const fact of facts) {
    if (!["CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED"].includes(fact.eventType)) continue;
    const key = fact.leadId ?? "__without_lead__";
    const balance = byLead.get(key) ?? { attempted: 0, resolved: 0 };
    if (fact.eventType === "CALL_ATTEMPTED") balance.attempted += fact.quantity;
    else balance.resolved += fact.quantity;
    byLead.set(key, balance);
  }
  return [...byLead.values()].reduce((sum, balance) => sum + Math.max(0, balance.attempted - Math.max(0, balance.resolved)), 0);
}
