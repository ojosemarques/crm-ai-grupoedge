import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getGeographicIntelligenceService } from "@/modules/geography/application/geographic-intelligence-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { GeographicWorkspace } from "./geographic-workspace";

export const dynamic="force-dynamic";

export default async function GeographicIntelligencePage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getGeographicIntelligenceService().getScreen(context, await searchParams);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide analytics-canvas"><PageHeader eyebrow="Revenue OS" title="Inteligência geográfica" description="Explore a distribuição da sua operação, compare regiões e acompanhe a cobertura comercial."/><GeographicWorkspace initial={screen}/></main>;
}
