import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { AcquisitionWorkspace } from "@/app/aquisicao/acquisition-workspace";
import { MediaPerformanceWorkspace } from "@/app/aquisicao/midia/media-performance-workspace";
import { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { getStrategyFunnelService } from "@/modules/marketing/application/strategy-funnel-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { workspaceDayRange } from "@/shared/core/time/workspace-time";

export const dynamic = "force-dynamic";

export default async function AcquisitionPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  for (const [name, boundary] of [["periodStart", "start"], ["periodEnd", "end"]] as const) {
    const value = query[name];
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) query[name] = workspaceDayRange(value, workspace.timeZone)[boundary].toISOString();
  }
  let screen;
  let media = null;
  let strategy = null;
  try {
    screen = await getMarketingAttributionService().getScreen(context, query);
    try {
      media = await getMediaPerformanceService().getScreen(context, { periodStart: screen.period.start, periodEnd: screen.period.end });
      strategy = await getStrategyFunnelService().screen(context, { periodStart: media.period.start, periodEnd: media.period.end });
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide analytics-canvas">
    <PageHeader eyebrow="Revenue OS" title="Aquisição e atribuição" description="Acompanhe investimento, impressões, cliques e a jornada completa da campanha até a venda e o recebimento." />
    {media && strategy ? <MediaPerformanceWorkspace initial={media} strategyInitial={strategy} basePath="/aquisicao" /> : null}
    <AcquisitionWorkspace initial={screen} />
  </main>;
}
