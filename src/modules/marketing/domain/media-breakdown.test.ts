import { describe, expect, it } from "vitest";
import { summarizeMediaBreakdown, type MediaBreakdownFact } from "./media-breakdown";
const fact: MediaBreakdownFact = { channelId: "channel", campaignId: "campaign", creativeId: null, currency: "BRL", spendCents: 10000n, impressions: 1000n, clicks: 100n, reportedLeads: 10n, missingMetrics: [] };
describe("performance por dimensão", () => {
  it("calcula Hook Rate sobre as mesmas impressões dos fatos com vídeo e informa cobertura", () => {
    const rows = summarizeMediaBreakdown([{ ...fact, videoViews3s: 300n }, { ...fact, videoViews3s: 100n, impressions: 500n }, { ...fact, impressions: 500n }], "campaign", new Map());
    expect(rows[0]).toMatchObject({ videoViews3s: 400, hookImpressions: 1500, hookRateBps: 2667, hookCoverageBps: 7500 });
  });
  it("preserva zero e diferencia vídeo ausente de impressões zeradas", () => {
    expect(summarizeMediaBreakdown([{ ...fact, videoViews3s: 0n }], "creative", new Map())[0]).toMatchObject({ videoViews3s: 0, hookRateBps: 0 });
    expect(summarizeMediaBreakdown([fact], "creative", new Map())[0]).toMatchObject({ videoViews3s: null, hookRateBps: null });
    expect(summarizeMediaBreakdown([{ ...fact, videoViews3s: 0n, impressions: 0n }], "creative", new Map())[0]?.hookRateBps).toBeNull();
    expect(summarizeMediaBreakdown([{ ...fact, videoViews3s: 10n, missingMetrics: ["impressions"] }], "creative", new Map())[0]?.hookRateBps).toBeNull();
  });
  it("calcula taxas sobre totais sem misturar moedas", () => {
    const rows = summarizeMediaBreakdown([fact, fact, { ...fact, currency: "USD" }], "campaign", new Map([["campaign", "Campanha"]]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: "Campanha", spendCents: 20000, cpmCents: 10000, ctrBps: 1000, cpcCents: 100, cplCents: 1000 });
  });
  it("não apresenta campos indisponíveis do provedor como zero ou CPL completo", () => {
    const rows = summarizeMediaBreakdown([fact, { ...fact, reportedLeads: 0n, missingMetrics: ["reportedLeads"] }], "creative", new Map());
    expect(rows[0]).toMatchObject({ label: "Não identificado", reportedLeads: null, cplCents: null });
  });
});
