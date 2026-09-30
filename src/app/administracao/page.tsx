import { redirect } from "next/navigation";

import { WorkspaceAdministration } from "@/app/administracao/workspace-administration";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getWorkspaceAdministrationService } from "@/modules/users/application/workspace-administration-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function AdministrationPage() {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getWorkspaceAdministrationService().getScreen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader description="Gerencie sua equipe, a disponibilidade e os acessos ao CRM." eyebrow="Administração" meta={context.displayName} title="Usuários e equipes" />
      <WorkspaceAdministration initialScreen={screen} />
    </main>
  );
}
