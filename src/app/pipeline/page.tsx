import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PipelinePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  try {
    screen = await getPreSalesPipelineService().getScreen(context, {
      q: first(params.q),
      responsible: first(params.responsible),
      priority: first(params.priority),
      stageCode: first(params.stageCode),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Etapas operacionais com regras de transição, PACTO, próxima ação e histórico verificadas no servidor."
        eyebrow="Processo comercial"
        meta={`Dados exibidos em ${screen.timeZone}`}
        title="Pipeline de pré-vendas"
      />
      <PreSalesPipelineWorkspace initialView={first(params.view) === "list" ? "list" : "board"} screen={screen} />
    </main>
  );
}
