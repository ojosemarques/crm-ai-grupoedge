import { redirect } from "next/navigation";
import { CommercialHistory } from "@/components/leads/commercial-history";
import { RouteAutoRefresh } from "@/components/layout/route-auto-refresh";

import {
  AdvertisingActivities,
  AdvertisingMetrics,
  AdvertisingNav,
  AdvertisingStock,
  advertisingViews,
  type AdvertisingView,
} from "@/app/anuncios/advertising-workspace";
import { PreSalesPipelineWorkspace } from "@/app/pipeline/pre-sales-pipeline-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAdvertisingWorkspaceService } from "@/modules/advertising/application/advertising-workspace-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdvertisingPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  const requestedView = first(params.view);
  const view: AdvertisingView = advertisingViews.includes(requestedView as AdvertisingView)
    ? requestedView as AdvertisingView
    : "pipeline";
  const database = getDatabaseClient();
  let pipeline = await database.pipeline.findFirst({
    where: { workspaceId: context.workspaceId, entityType: "LEAD", name: ADVERTISING_PIPELINE_NAME, deletedAt: null },
    select: { id: true },
  });
  if (!pipeline) {
    await ensureAdvertisingPipeline(database, context.workspaceId, context.actorId);
    pipeline = await database.pipeline.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, entityType: "LEAD", name: ADVERTISING_PIPELINE_NAME, deletedAt: null },
      select: { id: true },
    });
  }

  let pipelineScreen = null;
  let workspaceScreen = null;
  try {
    if (view === "pipeline") {
      pipelineScreen = await getPreSalesPipelineService().getScreen(context, {
        pipelineId: pipeline.id,
        q: first(params.q),
        responsible: first(params.responsible),
        priority: first(params.priority),
        stageCode: first(params.stageCode),
        phoneType: first(params.phoneType),
        gender: first(params.gender),
        stateCode: first(params.stateCode),
      });
    } else {
      workspaceScreen = await getAdvertisingWorkspaceService().getScreen(context, {
        pipelineId: pipeline.id,
        ...(first(params.page) ? { page: first(params.page) } : {}),
        ...(first(params.activityPage) ? { activityPage: first(params.activityPage) } : {}),
        ...(first(params.metricsPreset) ? { metricsPreset: first(params.metricsPreset) } : {}),
        ...(first(params.metricsFrom) ? { metricsFrom: first(params.metricsFrom) } : {}),
        ...(first(params.metricsTo) ? { metricsTo: first(params.metricsTo) } : {}),
      });
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT" && view === "metrics") {
      redirect("/anuncios?view=metrics&metricsPreset=LAST_30_DAYS");
    }
    throw error;
  }

  return (
    <main className="page-canvas">
      <RouteAutoRefresh />
      <PageHeader description="Pipeline exclusivo para leads de anúncios, com atividades e indicadores separados da Prospecção Ativa." eyebrow="Trabalho" title={ADVERTISING_PIPELINE_NAME} />
      <AdvertisingNav active={view} />
      {view === "pipeline" && pipelineScreen ? <PreSalesPipelineWorkspace basePath="/anuncios" fixedQuery={{ view: "pipeline" }} initialView="board" key={pipelineScreen.pipelineId} screen={pipelineScreen} showGenderFilter showPhoneTypeFilter showStateFilter showSubmissionDetails /> : null}
      {view === "stock" && workspaceScreen ? <AdvertisingStock screen={workspaceScreen} /> : null}
      {view === "activities" && workspaceScreen ? <AdvertisingActivities screen={workspaceScreen} /> : null}
      {view === "activities" ? <CommercialHistory basePath="/anuncios" context={context} params={params} pipelineName="Anúncios" /> : null}
      {view === "metrics" && workspaceScreen ? <AdvertisingMetrics screen={workspaceScreen} /> : null}
    </main>
  );
}
