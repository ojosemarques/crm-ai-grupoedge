import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { BusinessPipelineSwitcher } from "@/components/pipelines/business-pipeline-switcher";
import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { listBusinessPipelines } from "@/modules/pipelines/application/business-pipeline-navigation";
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
  let pipelines;
  try {
    [screen, pipelines] = await Promise.all([
      getPreSalesPipelineService().getScreen(context, {
        pipelineId: first(params.pipelineId),
        q: first(params.q),
        responsible: first(params.responsible),
        priority: first(params.priority),
        stageCode: first(params.stageCode),
      }),
      listBusinessPipelines(context),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader description="Acompanhe os contatos e avance cada conversa até a próxima etapa." eyebrow="Negócios" title="Pré-vendas" />
      <BusinessPipelineSwitcher pipelines={pipelines} selectedPipelineId={screen.pipelineId} />
      <PreSalesPipelineWorkspace initialView={first(params.view) === "list" ? "list" : "board"} screen={screen} />
    </main>
  );
}
