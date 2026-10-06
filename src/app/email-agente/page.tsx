import { redirect } from "next/navigation";

import {
  ProspectingActivities,
  ProspectingEmails,
  ProspectingMetrics,
  ProspectingNav,
  ProspectingOverview,
  ProspectingSettings,
  ProspectingStock,
  prospectingViews,
  type ProspectingView,
} from "@/app/email-agente/prospecting-workspace";
import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessPipelineSwitcher } from "@/components/pipelines/business-pipeline-switcher";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import {
  ACTIVE_PROSPECTING_PIPELINE_NAME,
  listBusinessPipelines,
} from "@/modules/pipelines/application/business-pipeline-navigation";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getProspectingWorkspaceService } from "@/modules/prospecting/application/prospecting-workspace-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActiveProspectingPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  const requestedView = first(params.view);
  const view: ProspectingView = prospectingViews.includes(requestedView as ProspectingView) ? requestedView as ProspectingView : "overview";
  let pipelineScreen = null;
  let pipelines: Awaited<ReturnType<typeof listBusinessPipelines>> = [];
  let workspaceScreen;
  try {
    workspaceScreen = await getProspectingWorkspaceService().getScreen(context, {
      ...(first(params.status) ? { status: first(params.status) } : {}),
      ...(first(params.role) ? { role: first(params.role) } : {}),
      ...(first(params.stateCode) ? { stateCode: first(params.stateCode)?.toUpperCase() } : {}),
      ...(first(params.page) ? { page: first(params.page) } : {}),
      ...(first(params.activityPage) ? { activityPage: first(params.activityPage) } : {}),
      ...(first(params.emailPage) ? { emailPage: first(params.emailPage) } : {}),
    });
    if (view === "pipeline") {
      pipelines = await listBusinessPipelines(context);
      const activeProspecting = pipelines.find((pipeline) => pipeline.entityType === "PROSPECTING");
      if (!activeProspecting) redirect("/pipeline");
      pipelineScreen = await getPreSalesPipelineService().getScreen(context, {
        pipelineId: activeProspecting.id,
        q: first(params.q), responsible: first(params.responsible), priority: first(params.priority), stageCode: first(params.stageCode),
      });
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Estoque validado, liberação por capacidade, cadência manual e e-mails governados pelo CRM."
        eyebrow="Negócios"
        title={ACTIVE_PROSPECTING_PIPELINE_NAME}
      />
      <ProspectingNav active={view} />
      {view === "overview" ? <ProspectingOverview screen={workspaceScreen} /> : null}
      {view === "pipeline" && pipelineScreen ? <><BusinessPipelineSwitcher pipelines={pipelines} selectedPipelineId={pipelineScreen.pipelineId} /><PreSalesPipelineWorkspace basePath="/email-agente?view=pipeline" fixedQuery={{ view: "pipeline" }} initialView="board" key={pipelineScreen.pipelineId} screen={pipelineScreen} /></> : null}
      {view === "stock" ? <ProspectingStock screen={workspaceScreen} /> : null}
      {view === "activities" ? <ProspectingActivities screen={workspaceScreen} /> : null}
      {view === "emails" ? <ProspectingEmails screen={workspaceScreen} /> : null}
      {view === "metrics" ? <ProspectingMetrics screen={workspaceScreen} /> : null}
      {view === "settings" ? <ProspectingSettings screen={workspaceScreen} /> : null}
    </main>
  );
}
