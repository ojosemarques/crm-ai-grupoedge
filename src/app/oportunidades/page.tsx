import { redirect } from "next/navigation";

import { OpportunityPipelineWorkspace } from "@/app/oportunidades/opportunity-pipeline-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function OpportunitiesPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  try {
    screen = await getOpportunityService().getPipelineScreen(context, {
      closerId: first(params.closerId),
      productId: first(params.productId),
      sourceId: first(params.sourceId),
      stageCode: first(params.stageCode),
      from: first(params.from),
      to: first(params.to),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader description="Acompanhe suas oportunidades, propostas e negociações." eyebrow="Negócios" title="Vendas" />
      <OpportunityPipelineWorkspace screen={screen} />
    </main>
  );
}
