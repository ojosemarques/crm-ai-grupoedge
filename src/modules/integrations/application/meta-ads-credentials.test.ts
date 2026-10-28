import { describe, expect, it } from "vitest";
import { EphemeralSecretResolver } from "./secret-resolver";
import { assertMetaAdsCredentialWorkspace, resolveMetaAdsTokenReference } from "./meta-ads-credentials";

describe("Meta reporting credential isolation", () => {
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
