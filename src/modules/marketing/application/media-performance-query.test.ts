import { describe, expect, it, vi } from "vitest";

import { mediaPerformanceFactScreenSelect, readCurrentMediaPerformanceFacts } from "./media-performance-service";

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

  it("deduplicates revisions in Postgres before returning screen facts", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const start = new Date("2026-10-20T00:00:00.000Z");
    const end = new Date("2026-11-19T00:00:00.000Z");

    await expect(readCurrentMediaPerformanceFacts({ $queryRaw: queryRaw } as never, "workspace-id", start, end))
      .resolves.toEqual([]);

    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[]; values: readonly unknown[] };
    expect(query.strings.join("?")).toContain('MAX("revision")');
    expect(query.strings.join("?")).toContain('GROUP BY "grainKey"');
    expect(query.strings.join("?")).toContain('fact."status" = \'CONFIRMED\'');
    expect(query.values).toEqual(["workspace-id", start, end, "workspace-id", start, end]);
  });
});
