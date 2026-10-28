import type { SecretResolver } from "./secret-resolver";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { META_ADS_ACCESS_TOKEN_REFERENCE } from "../domain/meta-ads-contracts";

export const META_ADS_REPORTING_TOKEN_REFERENCE = "META_ADS_REPORTING_ACCESS_TOKEN";
export const META_ADS_REPORTING_WORKSPACE_REFERENCE = "META_ADS_REPORTING_WORKSPACE_ID";
export const META_ADS_REPORTING_APP_SECRET_REFERENCE = "META_ADS_REPORTING_APP_SECRET";

export async function assertMetaAdsCredentialWorkspace(secrets: SecretResolver, referenceKey: string, workspaceId: string) {
  if (referenceKey !== META_ADS_REPORTING_TOKEN_REFERENCE) return;
  if (await secrets.resolve(META_ADS_REPORTING_WORKSPACE_REFERENCE) !== workspaceId) {
    throw new ApplicationError("A credencial de relatórios Meta não está vinculada a este workspace.", { code: "META_REPORTING_WORKSPACE_MISMATCH", statusCode: 403, expose: true });
  }
}

export async function resolveMetaAdsTokenReference(secrets: SecretResolver, workspaceId: string) {
  const reportingPresent = Boolean(await secrets.resolve(META_ADS_REPORTING_TOKEN_REFERENCE));
  const referenceKey = reportingPresent ? META_ADS_REPORTING_TOKEN_REFERENCE : META_ADS_ACCESS_TOKEN_REFERENCE;
  await assertMetaAdsCredentialWorkspace(secrets, referenceKey, workspaceId);
  return { referenceKey, present: reportingPresent || Boolean(await secrets.resolve(referenceKey)) };
}
