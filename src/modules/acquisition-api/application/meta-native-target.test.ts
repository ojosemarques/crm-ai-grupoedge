import { describe, expect, it } from "vitest";
import { assertMetaNativeTarget } from "./meta-native-target";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";

const target = { pageId: "931101203422256", businessId: "1484709821933266", pipelineId: "10000000-0000-4000-8000-000000000001", initialStageId: "10000000-0000-4000-8000-000000000002", importFrom: "2026-10-28T03:00:00Z", forms: [], fieldMapping: {} };
describe("vínculo da credencial Meta nativa", () => {
  const secrets = new EphemeralSecretResolver({ META_ADS_NATIVE_WORKSPACE_ID: "workspace-1", META_ADS_NATIVE_PAGE_ID: target.pageId, META_ADS_NATIVE_BUSINESS_ID: target.businessId });
  it("aceita somente a combinação provisionada no servidor", async () => {
    await expect(assertMetaNativeTarget(secrets, "workspace-1", target)).resolves.toBeUndefined();
  });
  it("recusa outro workspace, outra Página, outra BM e configuração ausente", async () => {
    for (const input of [{ workspace: "workspace-2", native: target }, { workspace: "workspace-1", native: { ...target, pageId: "999999999" } }, { workspace: "workspace-1", native: { ...target, businessId: "999999999" } }]) await expect(assertMetaNativeTarget(secrets, input.workspace, input.native)).rejects.toMatchObject({ code: "META_NATIVE_CREDENTIAL_TARGET_MISMATCH" });
    await expect(assertMetaNativeTarget(new EphemeralSecretResolver(), "workspace-1", target)).rejects.toMatchObject({ code: "META_NATIVE_CREDENTIAL_TARGET_MISMATCH" });
  });
});
