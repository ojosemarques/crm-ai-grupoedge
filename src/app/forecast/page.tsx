import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getForecastService } from "@/modules/forecast/application/forecast-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ForecastWorkspace, type ForecastScreenView } from "./forecast-workspace";

export const dynamic = "force-dynamic";

export default async function ForecastPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let screen: Awaited<ReturnType<ReturnType<typeof getForecastService>["screen"]>>;
  try {
    screen = await getForecastService().screen(context, query);
  } catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide analytics-canvas"><PageHeader eyebrow="Gestão comercial" title="Forecast" description="Planeje a receita, acompanhe compromissos e entenda a evolução das previsões." meta={`${context.displayName} · ${new Intl.DateTimeFormat("pt-BR", { timeZone: screen.cycles[0]?.timeZone ?? "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(screen.asOf))}`} /><ForecastWorkspace screen={screen as ForecastScreenView} /></main>;
}
