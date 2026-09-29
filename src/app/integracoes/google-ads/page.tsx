import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getGoogleAdsService } from "@/modules/integrations/application/google-ads-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { GoogleAdsWorkspace } from "@/app/integracoes/google-ads/google-ads-workspace";

export const dynamic = "force-dynamic";

export default async function GoogleAdsPage() {
  const context = await requirePageAuthentication();
  let initial;
  try {
    initial = await getGoogleAdsService().screen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · aquisição" title="Google Ads" description="Conector estritamente somente leitura para contas, campanhas, anúncios, ativos e métricas diárias. A validação externa permanece adiada." />
    <GoogleAdsWorkspace initial={initial} />
  </main>;
}
