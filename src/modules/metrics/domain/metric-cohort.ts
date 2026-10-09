type LeadFact = Readonly<{ eventType: string; leadId: string | null; quantity: number }>;

function positiveLeadIds(facts: readonly LeadFact[]): Set<string> {
  const balances = new Map<string, number>();
  for (const fact of facts) {
    if (!fact.leadId) continue;
    const key = `${fact.eventType}:${fact.leadId}`;
    balances.set(key, (balances.get(key) ?? 0) + fact.quantity);
  }
  return new Set([...balances]
    .filter(([, balance]) => balance > 0)
    .map(([key]) => key.slice(key.indexOf(":") + 1)));
}

export function summarizeLeadCohortRate(numeratorFacts: readonly LeadFact[], denominatorFacts: readonly LeadFact[]) {
  const denominatorLeads = positiveLeadIds(denominatorFacts);
  const numeratorLeads = positiveLeadIds(numeratorFacts);
  return {
    numerator: [...numeratorLeads].filter((leadId) => denominatorLeads.has(leadId)).length,
    denominator: denominatorLeads.size,
  };
}
