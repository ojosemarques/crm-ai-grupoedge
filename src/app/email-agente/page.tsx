import { redirect } from "next/navigation";

import {
  ProspectingActivities,
  ProspectingMetrics,
  ProspectingNav,
  ProspectingStock,
  prospectingViews,
  type ProspectingView,
} from "@/app/email-agente/prospecting-workspace";
import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { ACTIVE_PROSPECTING_PIPELINE_NAME } from "@/modules/pipelines/application/business-pipeline-navigation";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getProspectingWorkspaceService } from "@/modules/prospecting/application/prospecting-workspace-service";
import { ensureActiveProspectingPipeline } from "@/modules/settings/application/production-foundation-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActiveProspectingPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  const requestedView = first(params.view);
  const view: ProspectingView = prospectingViews.includes(requestedView as ProspectingView) ? requestedView as ProspectingView : "pipeline";
  let pipelineScreen = null;
  let workspaceScreen = null;
  try {
    if (view === "pipeline") {
      const database = getDatabaseClient();
      await ensureActiveProspectingPipeline(database, context.workspaceId, context.actorId);
      const activeProspecting = await database.pipeline.findFirstOrThrow({
        where: { workspaceId: context.workspaceId, entityType: "LEAD", name: ACTIVE_PROSPECTING_PIPELINE_NAME, deletedAt: null },
        select: { id: true },
      });
      pipelineScreen = await getPreSalesPipelineService().getScreen(context, {
        pipelineId: activeProspecting.id,
        q: first(params.q), responsible: first(params.responsible), priority: first(params.priority), stageCode: first(params.stageCode), phoneType: first(params.phoneType),
      });
    } else {
      workspaceScreen = await getProspectingWorkspaceService().getScreen(context, {
        ...(first(params.status) ? { status: first(params.status) } : {}),
        ...(first(params.role) ? { role: first(params.role) } : {}),
        ...(first(params.stateCode) ? { stateCode: first(params.stateCode)?.toUpperCase() } : {}),
        ...(first(params.page) ? { page: first(params.page) } : {}),
        ...(first(params.activityPage) ? { activityPage: first(params.activityPage) } : {}),
        ...(first(params.emailPage) ? { emailPage: first(params.emailPage) } : {}),
      });
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Pipeline comercial integrado aos leads, ao Meu Dia, às atividades e aos indicadores do CRM."
        eyebrow="Negócios"
        title={ACTIVE_PROSPECTING_PIPELINE_NAME}
      />
      <ProspectingNav active={view} />
      {view === "pipeline" && pipelineScreen ? <PreSalesPipelineWorkspace basePath="/email-agente?view=pipeline" fixedQuery={{ view: "pipeline" }} initialView="board" key={pipelineScreen.pipelineId} screen={pipelineScreen} showPhoneTypeFilter /> : null}
      {view === "stock" && workspaceScreen ? <ProspectingStock screen={workspaceScreen} /> : null}
      {view === "activities" && workspaceScreen ? <ProspectingActivities screen={workspaceScreen} /> : null}
      {view === "metrics" && workspaceScreen ? <ProspectingMetrics screen={workspaceScreen} /> : null}
    </main>
  );
}
