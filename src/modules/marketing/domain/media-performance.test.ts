import { describe, expect, it } from "vitest";
import { calculateMediaMetrics, parseMarketingPerformanceCsv } from "@/modules/marketing/domain/media-performance";

const header = "date,channelKey,channelName,spendCents,impressions,reach,clicks,linkClicks,landingPageViews,reportedLeads,reportedPurchases,reportedRevenueCents";
describe("CRM-39 performance de mídia", () => {
  it("valida CSV, valores e fórmula injetável", () => {
    expect(parseMarketingPerformanceCsv(`${header}\n2046-04-20,meta,Meta Ads,10000,1000,800,100,80,70,10,2,50000`).rows[0]?.valid).toBe(true);
    expect(parseMarketingPerformanceCsv(`${header}\n2046-04-20,meta,=cmd,10000,1000,800,100,80,70,10,2,50000`).rows[0]?.valid).toBe(false);
    expect(parseMarketingPerformanceCsv(`${header}\n2046-04-20,meta,Meta,-1,1000,800,100,80,70,10,2,50000`).rows[0]?.valid).toBe(false);
    expect(parseMarketingPerformanceCsv(`${header}\n2046-04-20,meta,Meta,1,100,101,1,1,1,1,0,0`).rows[0]?.errors.join(" ")).toContain("Alcance");
  });
  it("não inventa razão sem denominador", () => {
    const metrics = calculateMediaMetrics({ spendCents: 1000, impressions: 0, clicks: 0, reportedLeads: 0, qualified: 0, opportunities: 0, wins: 0, attributedWonRevenueCents: 0 });
    expect(metrics.filter((metric) => metric.denominator === 0).every((metric) => metric.value === null)).toBe(true);
    expect(metrics[0]).toMatchObject({ unavailableReason: "SEM_BASE", numerator: 1000, denominator: 0 });
  });
});
