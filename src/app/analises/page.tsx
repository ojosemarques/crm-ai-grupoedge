import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { PageHeader } from "@/components/layout/page-header";
import { AnalyticsWorkspace } from "./analytics-workspace";

export const dynamic = "force-dynamic";
export default async function AnalyticsPage() {
  const context = await requirePageAuthentication();
  return <main className="page-canvas"><PageHeader eyebrow="Análises gerenciais" title="Dashboards e indicadores" description="Monte visões salvas com métricas canônicas, filtros rastreáveis e acesso aos registros de origem." meta={context.displayName} /><AnalyticsWorkspace /></main>;
}
