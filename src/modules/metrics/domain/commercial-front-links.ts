import type { DashboardQuery } from "./dashboard-contracts";

export function commercialFrontEvidenceHref(query: DashboardQuery, measure: string, memberId?: string, pipelineId?: string) {
  const params = new URLSearchParams({ from: query.from, to: query.to, measure, mode: query.mode ?? "ALL" });
  if (memberId) params.set("memberId", memberId);
  for (const [key, values] of Object.entries(query.filters)) {
    for (const value of key === "pipelineIds" && pipelineId ? [pipelineId] : values) params.append(key, value);
  }
  return `/dashboard/evidencias?${params}`;
}
