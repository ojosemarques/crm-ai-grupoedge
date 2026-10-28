import { describe, expect, it } from "vitest";
import {
  classifyMetaAction,
  decimalStringToMinorUnits,
  integerMetric,
  metaActionMoneyValue,
  metaReportedLeads,
  metaReportedPurchases,
  metaReportedRevenueCents,
  metaActionValue,
  metaVideoComparable,
  metaAdsConfigurationSchema,
  metaAdsCampaignSchema,
  normalizeMetaMediaStatus,
} from "@/modules/integrations/domain/meta-ads-contracts";

describe("CRM-40 contratos do Meta Ads", () => {
  it("não soma conversões agregadas com seus componentes sobrepostos", () => {
    const components = [{ action_type: "onsite_conversion.lead_grouped", value: "25" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "9" }];
    expect(metaReportedLeads([{ action_type: "lead", value: "34" }, ...components])).toBe(34n);
    expect(metaReportedLeads(components)).toBe(34n);
    expect(metaReportedLeads([{ action_type: "lead", value: "0" }, ...components])).toBe(0n);
    const purchases = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"].map((action_type) => ({ action_type, value: "2" }));
    expect(metaReportedPurchases(purchases)).toBe(2n);
    expect(metaReportedRevenueCents(purchases.map((row) => ({ ...row, value: "10.50" })))).toBe(1050n);
    expect(metaReportedLeads(undefined)).toBeNull();
  });
  it("normaliza o offset ISO da Graph API sem aceitar datas inválidas", () => {
    const campaign = { id: "123456", name: "Campanha", start_time: "2026-10-28T09:15:00-0300", stop_time: "2026-10-29T09:15:00+0530" };
    expect(metaAdsCampaignSchema.parse(campaign)).toMatchObject({ start_time: "2026-10-28T09:15:00-03:00", stop_time: "2026-10-29T09:15:00+05:30" });
    expect(metaAdsCampaignSchema.parse({ ...campaign, start_time: "2026-10-28T12:15:00Z" }).start_time).toBe("2026-10-28T12:15:00Z");
    expect(() => metaAdsCampaignSchema.parse({ ...campaign, start_time: "2026-13-28T09:15:00-0300" })).toThrow();
    expect(() => metaAdsCampaignSchema.parse({ ...campaign, start_time: "not-a-date" })).toThrow();
  });
  it("considera somente video_view como visualização de 3s e detecta atualização sem mudança de custo", () => {
    expect(metaVideoComparable([{ action_type: "video_view", value: "0" }])).toEqual({ videoMetricVersion: "meta-3s-v1", videoViews3s: "0" });
    expect(metaVideoComparable([{ action_type: "video_continuous_2_sec_watched_actions", value: "100" }]).videoViews3s).toBeNull();
    expect(metaVideoComparable(undefined).videoViews3s).toBeNull();
    expect(metaVideoComparable([{ action_type: "video_view", value: "100" }])).not.toEqual(metaVideoComparable([{ action_type: "video_view", value: "101" }]));
    expect(classifyMetaAction("video_view")).toBe("RECOGNIZED");
  });
  it("valida somente versão e contas permitidas", () => {
    expect(metaAdsConfigurationSchema.parse({ graphApiVersion: "v26.0", selectedAccountIds: ["act_123456"], initialSince: "2026-09-01" })).toMatchObject({ lookbackDays: 7 });
    expect(() => metaAdsConfigurationSchema.parse({ graphApiVersion: "v99.0", selectedAccountIds: [], initialSince: "2026-09-01" })).toThrow();
    expect(() => metaAdsConfigurationSchema.parse({ graphApiVersion: "v26.0", selectedAccountIds: ["https://evil.test"], initialSince: "2026-09-01" })).toThrow();
  });

  it("converte dinheiro decimal sem ponto flutuante", () => {
    expect(decimalStringToMinorUnits("123.45")).toBe(12345n);
    expect(decimalStringToMinorUnits("1.999")).toBe(200n);
    expect(decimalStringToMinorUnits("0")).toBe(0n);
    expect(() => decimalStringToMinorUnits("-1")).toThrow("INVALID_DECIMAL");
  });

  it("preserva zero, ausência e classificação de ações", () => {
    const actions = [{ action_type: "lead", value: "0" }, { action_type: "custom_unknown", value: "3" }];
    expect(metaActionValue(actions, ["lead"])).toBe(0n);
    expect(metaActionValue(undefined, ["lead"])).toBeNull();
    expect(metaActionMoneyValue([{ action_type: "purchase", value: "10.50" }], ["purchase"])).toBe(1050n);
    expect(integerMetric(undefined)).toBeNull();
    expect(classifyMetaAction("lead")).toBe("RECOGNIZED");
    expect(classifyMetaAction("custom_unknown")).toBe("UNKNOWN");
  });

  it("traduz status sem inventar equivalência", () => {
    expect(normalizeMetaMediaStatus("ACTIVE")).toBe("ACTIVE");
    expect(normalizeMetaMediaStatus("PAUSED")).toBe("PAUSED");
    expect(normalizeMetaMediaStatus("SOMETHING_NEW")).toBe("REVIEW_REQUIRED");
  });
});
