import { describe, expect, it } from "vitest";

import { mediaPerformanceFactScreenSelect } from "./media-performance-service";

describe("media performance screen query", () => {
  it("loads only the fact fields used to render the screen", () => {
    expect(mediaPerformanceFactScreenSelect).toEqual({
      id: true,
      channelId: true,
      campaignId: true,
      creativeId: true,
      grainKey: true,
      revision: true,
      status: true,
      periodStart: true,
      currency: true,
      spendCents: true,
      impressions: true,
      reach: true,
      clicks: true,
      linkClicks: true,
      landingPageViews: true,
      reportedLeads: true,
      reportedPurchases: true,
      reportedRevenueCents: true,
      sourceProvider: true,
      missingMetrics: true,
    });
    expect(mediaPerformanceFactScreenSelect).not.toHaveProperty("sourceEvidence");
  });
});
