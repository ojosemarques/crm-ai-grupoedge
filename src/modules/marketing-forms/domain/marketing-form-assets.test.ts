import { describe, expect, it } from "vitest";

import { isAllowedMarketingFormAssetUrl, marketingFormAssetOrigins } from "@/modules/marketing-forms/domain/marketing-form-assets";

describe("allowlist de assets dos formulários", () => {
  it("normaliza somente origins HTTPS exatas", () => {
    expect(marketingFormAssetOrigins("https://cdn.example, https://assets.example:8443/,http://inseguro.example,https://cdn.example/path")).toEqual([
      "https://assets.example:8443",
      "https://cdn.example",
    ]);
  });

  it("aceita caminho no asset apenas quando a origin está autorizada", () => {
    const origins = marketingFormAssetOrigins("https://cdn.example");
    expect(isAllowedMarketingFormAssetUrl("https://cdn.example/brand/logo.png", origins)).toBe(true);
    expect(isAllowedMarketingFormAssetUrl("https://other.example/logo.png", origins)).toBe(false);
    expect(isAllowedMarketingFormAssetUrl("https://user:secret@cdn.example/logo.png", origins)).toBe(false);
  });
});
