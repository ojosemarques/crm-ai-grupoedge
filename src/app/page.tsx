import { redirect } from "next/navigation";
import { RoleHomeView } from "@/app/home/role-home-view";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getWorkspaceExperienceService } from "@/modules/workspace-experience/application/workspace-experience-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication(); const raw = await searchParams; const view = typeof raw.view === "string" ? raw.view : undefined;
  let screen;
  try { screen = await getWorkspaceExperienceService().getHome(context, view ? { view } : {}); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><RoleHomeView screen={screen} /></main>;
}
