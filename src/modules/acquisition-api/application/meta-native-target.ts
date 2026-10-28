import type { MetaNativeConfiguration } from "../domain/meta-native-contracts";
import type { SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { ApplicationError } from "@/shared/core/errors/application-error";

// Referências de ambiente são globais ao deploy; o vínculo impede outro tenant de reutilizá-las.
export async function assertMetaNativeTarget(secrets: SecretResolver, workspaceId: string, native: MetaNativeConfiguration) {
  const [workspace, page, business] = await Promise.all([
    secrets.resolve("META_ADS_NATIVE_WORKSPACE_ID"), secrets.resolve("META_ADS_NATIVE_PAGE_ID"), secrets.resolve("META_ADS_NATIVE_BUSINESS_ID"),
  ]);
  if (workspace !== workspaceId || page !== native.pageId || business !== native.businessId) throw new ApplicationError("Credencial nativa não pertence a este workspace, Página e portfólio.", { code: "META_NATIVE_CREDENTIAL_TARGET_MISMATCH", statusCode: 403, expose: true });
}
