import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import type { RevenueDrilldownPage, RevenueMetricsScreen } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { RevenueMetricsWorkspace } from "./revenue-metrics-workspace";
export const dynamic = "force-dynamic";
export default async function RevenueMetricsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const input = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined));
  const section = typeof raw.section === "string" ? raw.section : "summary";
  let screen: RevenueMetricsScreen;
  let drilldown: RevenueDrilldownPage | null;
  try {
    const service = getRevenueMetricsService();
    screen = await service.getScreen(context, input);
    drilldown = section === "drilldown" && typeof raw.metric === "string" ? await service.getDrilldown(context, input) : null;
  } catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Revenue Operations" title="Métricas de receita" description="Aquisição, conversão, contratos, MRR, retenção e forecast com definições únicas e drilldown." meta={`${context.displayName} · ${screen.scope}`} /><RevenueMetricsWorkspace screen={screen} section={section} drilldown={drilldown} /></main>;
}
