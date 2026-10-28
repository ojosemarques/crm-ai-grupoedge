import type { SecretResolver } from "./secret-resolver";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { META_ADS_ACCESS_TOKEN_REFERENCE } from "../domain/meta-ads-contracts";

export const META_ADS_REPORTING_TOKEN_REFERENCE = "META_ADS_REPORTING_ACCESS_TOKEN";
export const META_ADS_REPORTING_WORKSPACE_REFERENCE = "META_ADS_REPORTING_WORKSPACE_ID";
export const META_ADS_REPORTING_APP_SECRET_REFERENCE = "META_ADS_REPORTING_APP_SECRET";
export const META_ADS_REPORTING_BUSINESS_REFERENCE = "META_ADS_REPORTING_BUSINESS_ID";
export const META_ADS_REPORTING_ACCOUNTS_REFERENCE = "META_ADS_REPORTING_ACCOUNT_IDS";

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

export async function assertMetaAdsReportingSelection(secrets: SecretResolver, referenceKey: string, workspaceId: string, config: { businessId?: string | undefined; selectedAccountIds: string[] }) {
  await assertMetaAdsCredentialWorkspace(secrets, referenceKey, workspaceId);
  if (referenceKey !== META_ADS_REPORTING_TOKEN_REFERENCE) return;
  const businessId = await secrets.resolve(META_ADS_REPORTING_BUSINESS_REFERENCE);
  const allowed = (await secrets.resolve(META_ADS_REPORTING_ACCOUNTS_REFERENCE) ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!businessId || businessId !== config.businessId || !allowed.length || !config.selectedAccountIds.length || config.selectedAccountIds.some((id) => !allowed.includes(id))) {
    throw new ApplicationError("A seleção de BM e conta não corresponde à autorização de relatórios deste workspace.", { code: "META_REPORTING_TARGET_MISMATCH", statusCode: 403, expose: true });
  }
}
