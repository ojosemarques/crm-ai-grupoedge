import { describe, expect, it } from "vitest";
import { EphemeralSecretResolver } from "./secret-resolver";
import { assertMetaAdsCredentialWorkspace, assertMetaAdsReportingSelection, resolveMetaAdsTokenReference } from "./meta-ads-credentials";

describe("Meta reporting credential isolation", () => {
  it("pins reporting to the exact approved BM and account list", async () => {
    const secrets = new EphemeralSecretResolver({ META_ADS_REPORTING_WORKSPACE_ID: "workspace-a", META_ADS_REPORTING_BUSINESS_ID: "777777", META_ADS_REPORTING_ACCOUNT_IDS: "act_123456" });
    await expect(assertMetaAdsReportingSelection(secrets, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "777777", selectedAccountIds: ["act_123456"] })).resolves.toBeUndefined();
    await expect(assertMetaAdsReportingSelection(secrets, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "888888", selectedAccountIds: ["act_123456"] })).rejects.toMatchObject({ code: "META_REPORTING_TARGET_BUSINESS_MISMATCH", statusCode: 403 });
    await expect(assertMetaAdsReportingSelection(secrets, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "777777", selectedAccountIds: ["act_654321"] })).rejects.toMatchObject({ code: "META_REPORTING_TARGET_ACCOUNT_MISMATCH", statusCode: 403 });
    await expect(assertMetaAdsReportingSelection(secrets, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "777777", selectedAccountIds: [] })).rejects.toMatchObject({ code: "META_REPORTING_TARGET_ACCOUNT_SELECTION_MISSING", statusCode: 403 });
  });
  it("identifies missing reporting target bindings without exposing their values", async () => {
    const base = { META_ADS_REPORTING_WORKSPACE_ID: "workspace-a", META_ADS_REPORTING_BUSINESS_ID: "777777", META_ADS_REPORTING_ACCOUNT_IDS: "act_123456" };
    const withoutBusiness = new EphemeralSecretResolver({ META_ADS_REPORTING_WORKSPACE_ID: base.META_ADS_REPORTING_WORKSPACE_ID, META_ADS_REPORTING_ACCOUNT_IDS: base.META_ADS_REPORTING_ACCOUNT_IDS });
    const withoutAccounts = new EphemeralSecretResolver({ META_ADS_REPORTING_WORKSPACE_ID: base.META_ADS_REPORTING_WORKSPACE_ID, META_ADS_REPORTING_BUSINESS_ID: base.META_ADS_REPORTING_BUSINESS_ID });
    await expect(assertMetaAdsReportingSelection(withoutBusiness, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "777777", selectedAccountIds: ["act_123456"] })).rejects.toMatchObject({ code: "META_REPORTING_TARGET_BUSINESS_MISSING" });
    await expect(assertMetaAdsReportingSelection(withoutAccounts, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a", { businessId: "777777", selectedAccountIds: ["act_123456"] })).rejects.toMatchObject({ code: "META_REPORTING_TARGET_ACCOUNT_ALLOWLIST_MISSING" });
  });
  it("keeps the existing token reference for legacy connections", async () => {
    expect(await resolveMetaAdsTokenReference(new EphemeralSecretResolver({ META_ADS_ACCESS_TOKEN: "capi-token" }), "workspace-a")).toEqual({ referenceKey: "META_ADS_ACCESS_TOKEN", present: true });
  });
  it("prefers a separate reporting token without returning either credential", async () => {
    const reference = await resolveMetaAdsTokenReference(new EphemeralSecretResolver({ META_ADS_ACCESS_TOKEN: "capi-token", META_ADS_REPORTING_ACCESS_TOKEN: "reporting-token", META_ADS_REPORTING_WORKSPACE_ID: "workspace-a" }), "workspace-a");
    expect(reference).toEqual({ referenceKey: "META_ADS_REPORTING_ACCESS_TOKEN", present: true });
    expect(JSON.stringify(reference)).not.toMatch(/capi-token|reporting-token/);
  });
  it.each([undefined, "workspace-b"])("rejects a missing or different workspace binding (%s)", async (binding) => {
    const secrets = new EphemeralSecretResolver({ META_ADS_REPORTING_ACCESS_TOKEN: "reporting-token", ...(binding ? { META_ADS_REPORTING_WORKSPACE_ID: binding } : {}) });
    await expect(resolveMetaAdsTokenReference(secrets, "workspace-a")).rejects.toMatchObject({ code: "META_REPORTING_WORKSPACE_MISMATCH", statusCode: 403 });
    await expect(assertMetaAdsCredentialWorkspace(secrets, "META_ADS_REPORTING_ACCESS_TOKEN", "workspace-a")).rejects.toMatchObject({ statusCode: 403 });
  });
});
