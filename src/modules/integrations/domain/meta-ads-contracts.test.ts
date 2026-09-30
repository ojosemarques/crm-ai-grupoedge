import { describe, expect, it } from "vitest";
import {
  classifyMetaAction,
  decimalStringToMinorUnits,
  integerMetric,
  metaActionMoneyValue,
  metaActionValue,
  metaVideoComparable,
  metaAdsConfigurationSchema,
  normalizeMetaMediaStatus,
} from "@/modules/integrations/domain/meta-ads-contracts";

describe("CRM-40 contratos do Meta Ads", () => {
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
