import { redirect } from "next/navigation";

import { CampaignsWorkspace } from "@/app/campanhas/campaigns-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOutboundCampaignService } from "@/modules/campaigns/application/outbound-campaign-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const context = await requirePageAuthentication();
  let initial;
  try {
    initial = await getOutboundCampaignService().screen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Comunicação em escala" title="Campanhas de envio" description="Monte o público, congele a prévia e aprove a execução antes de entrar na fila. Aquisição e mídia permanecem em um módulo separado." />
    <CampaignsWorkspace initial={initial} />
  </main>;
}
