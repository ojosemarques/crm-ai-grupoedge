import { redirect } from "next/navigation";

import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessPipelineSwitcher } from "@/components/pipelines/business-pipeline-switcher";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import {
  ACTIVE_PROSPECTING_PIPELINE_NAME,
  listBusinessPipelines,
} from "@/modules/pipelines/application/business-pipeline-navigation";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActiveProspectingPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  let pipelines;
  try {
    pipelines = await listBusinessPipelines(context);
    const activeProspecting = pipelines.find((pipeline) => pipeline.entityType === "PROSPECTING");
    if (!activeProspecting) redirect("/pipeline");
    screen = await getPreSalesPipelineService().getScreen(context, {
      pipelineId: activeProspecting.id,
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
        description="Organize a prospecção comercial, avance os contatos e acompanhe cada próxima ação."
        eyebrow="Negócios"
        title={ACTIVE_PROSPECTING_PIPELINE_NAME}
      />
      <BusinessPipelineSwitcher pipelines={pipelines} selectedPipelineId={screen.pipelineId} />
      <PreSalesPipelineWorkspace
        basePath="/email-agente"
        initialView={first(params.view) === "list" ? "list" : "board"}
        key={screen.pipelineId}
        screen={screen}
      />
    </main>
  );
}
