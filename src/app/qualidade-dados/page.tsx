import { redirect } from "next/navigation";

import { DataQualityWorkspace } from "@/app/qualidade-dados/data-quality-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getDataQualityService } from "@/modules/data-quality/application/data-quality-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function DataQualityPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let screen: Awaited<ReturnType<ReturnType<typeof getDataQualityService>["getScreen"]>>;
  try {
    screen = await getDataQualityService().getScreen(context, query);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Revenue OS" title="Qualidade de dados" description="Encontre duplicidades, revise divergências e mantenha seus registros organizados." meta={`Atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: screen.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(screen.generatedAt))}`} /><DataQualityWorkspace initial={screen} /></main>;
}
