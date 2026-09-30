export type FunnelDimension = "source" | "campaign" | "creative" | "utmCampaign" | "utmContent";
type Dimension = Readonly<{ id: string; name: string }> | null;
export type FunnelLead = Readonly<{
  id: string;
  source: Dimension;
  campaign: Dimension;
  creative: Dimension;
  utmCampaign: string | null;
  utmContent: string | null;
  tags: readonly string[];
  meetings: readonly { status: string }[];
  wins: readonly { amountCents: number }[];
}>;

function emptyCounts() {
  return { leads: 0, scheduled: 0, completed: 0, noShow: 0, buyers: 0, sales: 0, revenueCents: 0, tier1: 0, tier2: 0, tier3: 0, unclassified: 0, representatives: 0 };
}

export function summarizeAcquisitionFunnel(leads: readonly FunnelLead[], dimension: FunnelDimension) {
  const rows = new Map<string, ReturnType<typeof emptyCounts> & { key: string; label: string }>();
  for (const lead of leads) {
    const value = lead[dimension];
    const key = typeof value === "string" ? value : value?.id ?? "unattributed";
    const label = typeof value === "string" ? value : value?.name ?? "Não identificado";
    const row = rows.get(key) ?? { key, label, ...emptyCounts() };
    row.leads += 1;
    // Each stage counts people, not meetings; one person may have both a no-show and a completed meeting.
    row.scheduled += Number(lead.meetings.length > 0);
    row.completed += Number(lead.meetings.some((meeting) => meeting.status === "COMPLETED"));
    row.noShow += Number(lead.meetings.some((meeting) => meeting.status === "NO_SHOW"));
    row.buyers += Number(lead.wins.length > 0);
    row.sales += lead.wins.length;
    row.revenueCents += lead.wins.reduce((sum, sale) => sum + sale.amountCents, 0);
    const tags = new Set(lead.tags.map((tag) => tag.trim().toLowerCase().replace(/[\s_-]+/g, "")));
    const tiers = ([1, 2, 3] as const).filter((tier) => tags.has(`tier${tier}`));
    if (tiers.length === 1) row[`tier${tiers[0]!}`] += 1;
    else row.unclassified += 1;
    row.representatives += Number(tags.has("representante"));
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.leads - left.leads || left.label.localeCompare(right.label, "pt-BR"));
}
