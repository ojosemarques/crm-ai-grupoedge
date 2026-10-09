type TimedLead = Readonly<{ leadId: string; occurredAt: string }>;
type TimedFact = TimedLead & Readonly<{ eventType: string; sourceEntityType: string; quantity: number }>;

export function earliestLeadMilestones(rows: readonly TimedLead[]): Map<string, string> {
  const earliest = new Map<string, string>();
  for (const row of rows) {
    const prior = earliest.get(row.leadId);
    if (!prior || row.occurredAt < prior) earliest.set(row.leadId, row.occurredAt);
  }
  return earliest;
}

export function leadMilestoneTimeline(rows: readonly TimedLead[]): Map<string, readonly string[]> {
  const timeline = new Map<string, string[]>();
  for (const row of rows) {
    const times = timeline.get(row.leadId) ?? [];
    times.push(row.occurredAt);
    timeline.set(row.leadId, times);
  }
  for (const [leadId, times] of timeline) timeline.set(leadId, [...new Set(times)].sort());
  return timeline;
}

export function effectiveLeadMilestones(
  rows: readonly TimedLead[],
  facts: readonly (Omit<TimedFact, "leadId"> & Readonly<{ leadId: string | null }>)[],
  eventTypes: readonly string[],
  allowedLeads: ReadonlySet<string>,
  sourceEntityType?: string,
): Map<string, readonly string[]> {
  const timeline = leadMilestoneTimeline(rows);
  const observed = new Map<string, Map<string, number>>();
  for (const fact of facts) {
    if (!fact.leadId || !eventTypes.includes(fact.eventType) || sourceEntityType && fact.sourceEntityType !== sourceEntityType) continue;
    const byTime = observed.get(fact.leadId) ?? new Map<string, number>();
    byTime.set(fact.occurredAt, (byTime.get(fact.occurredAt) ?? 0) + fact.quantity);
    observed.set(fact.leadId, byTime);
  }
  for (const [leadId, byTime] of observed) {
    const activeTimes = [...byTime].filter(([, balance]) => balance > 0).map(([at]) => at).sort();
    if (activeTimes.length > 0) timeline.set(leadId, activeTimes);
    else timeline.delete(leadId);
  }
  for (const leadId of timeline.keys()) if (!allowedLeads.has(leadId)) timeline.delete(leadId);
  return timeline;
}

export function chronologicalLeadStages<const T extends readonly ReadonlyMap<string, readonly string[]>[]>(
  receipts: ReadonlyMap<string, string>,
  milestones: T,
): { readonly [K in keyof T]: ReadonlyMap<string, string> } {
  let reached = new Map(receipts);
  return Object.freeze(milestones.map((milestone) => {
    reached = new Map([...reached].flatMap(([leadId, previousAt]) => {
      const reachedAt = milestone.get(leadId)?.find((at) => at >= previousAt);
      return reachedAt ? [[leadId, reachedAt] as const] : [];
    }));
    return reached;
  })) as { readonly [K in keyof T]: ReadonlyMap<string, string> };
}

export function applyLedgerMilestoneBalance(
  initial: ReadonlySet<string>,
  balances: ReadonlyMap<string, number>,
  eventPrefixes: readonly string[],
): Set<string> {
  const result = new Set(initial);
  const observed = new Set<string>();
  const positive = new Set<string>();
  for (const [key, balance] of balances) {
    if (!eventPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    const leadId = key.slice(key.lastIndexOf(":") + 1);
    observed.add(leadId);
    if (balance > 0) positive.add(leadId);
  }
  for (const leadId of observed) {
    if (positive.has(leadId)) result.add(leadId);
    else result.delete(leadId);
  }
  return result;
}
