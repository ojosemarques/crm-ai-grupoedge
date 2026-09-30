import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getGoalService } from "@/modules/goals/application/goal-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { GoalsWorkspace, type GoalsScreenView } from "./goals-workspace";

export const dynamic = "force-dynamic";

export default async function GoalsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let screen: Awaited<ReturnType<ReturnType<typeof getGoalService>["screen"]>>;
  try {
    screen = await getGoalService().screen(context, query);
  } catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Planejamento comercial" title="Metas e quotas" description="Acompanhe os objetivos da equipe, o progresso e os resultados de cada período." meta={`${context.displayName} · ${screen.timeZone}`} /><GoalsWorkspace screen={screen as GoalsScreenView} /></main>;
}
