export type MediaBreakdownDimension = "channel" | "campaign" | "creative";
export type MediaBreakdownFact = Readonly<{
  channelId: string; campaignId: string | null; creativeId: string | null; currency: string;
  spendCents: bigint; impressions: bigint; clicks: bigint; reportedLeads: bigint; missingMetrics: readonly string[];
  videoViews3s?: bigint | null;
}>;

export function summarizeMediaBreakdown(facts: readonly MediaBreakdownFact[], dimension: MediaBreakdownDimension, labels: ReadonlyMap<string, string>) {
  const rows = new Map<string, { key: string; label: string; currency: string; spendCents: number; impressions: number; clicks: number; reportedLeads: number; videoViews3s: number; hookImpressions: number; hookMeasuredFacts: number; missing: Set<string> }>();
  for (const fact of facts) {
    const id = fact[`${dimension}Id`] ?? "unattributed";
    // Never sum currencies or infer the creative from a campaign's display name.
    const key = `${id}:${fact.currency}`;
    const row = rows.get(key) ?? { key, label: labels.get(id) ?? "Não identificado", currency: fact.currency, spendCents: 0, impressions: 0, clicks: 0, reportedLeads: 0, videoViews3s: 0, hookImpressions: 0, hookMeasuredFacts: 0, missing: new Set<string>() };
    for (const metric of ["spendCents", "impressions", "clicks", "reportedLeads"] as const) row[metric] += Number(fact[metric]);
    for (const missing of fact.missingMetrics) row.missing.add(missing);
    if (fact.videoViews3s !== undefined && fact.videoViews3s !== null && !fact.missingMetrics.includes("impressions")) {
      row.videoViews3s += Number(fact.videoViews3s);
      row.hookImpressions += Number(fact.impressions);
      row.hookMeasuredFacts += 1;
    }
    rows.set(key, row);
  }
  return [...rows.values()].map(({ missing, ...row }) => {
    const ratio = (numerator: "spendCents" | "clicks", denominator: "impressions" | "clicks" | "reportedLeads", scale: number) => missing.has(numerator) || missing.has(denominator) || !row[denominator] ? null : Math.round(row[numerator] * scale / row[denominator]);
    return { ...row, videoViews3s: row.hookMeasuredFacts ? row.videoViews3s : null, hookRateBps: row.hookImpressions > 0 ? Math.round(row.videoViews3s * 10000 / row.hookImpressions) : null, hookCoverageBps: missing.has("impressions") || !row.impressions ? null : Math.round(row.hookImpressions * 10000 / row.impressions), reportedLeads: missing.has("reportedLeads") ? null : row.reportedLeads, cpmCents: ratio("spendCents", "impressions", 1000), ctrBps: ratio("clicks", "impressions", 10000), cpcCents: ratio("spendCents", "clicks", 1), cplCents: ratio("spendCents", "reportedLeads", 1) };
  }).sort((left, right) => right.spendCents - left.spendCents);
}
