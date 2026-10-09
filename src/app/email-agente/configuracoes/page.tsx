import { redirect } from "next/navigation";

import {
  ProspectingEmails,
  ProspectingSettings,
} from "@/app/email-agente/prospecting-workspace";
import { ProspectingLaunchActions } from "@/app/email-agente/configuracoes/prospecting-launch-actions";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getProspectingWorkspaceService } from "@/modules/prospecting/application/prospecting-workspace-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function ProspectingSettingsPage() {
  const context = await requirePageAuthentication();
  let screen;

  try {
    screen = await getProspectingWorkspaceService().getScreen(context, {});
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Gates, remetentes, templates e ordens da cadência automática."
        eyebrow="Prospecção ativa"
        title="Configuração de e-mail"
      />
      {screen.permissions.manage ? (
        <ProspectingLaunchActions
          canaryApproved={Boolean(screen.settings?.canaryApprovedAt)}
          privacyApproved={Boolean(screen.settings?.privacyApprovedAt)}
        />
      ) : null}
      <ProspectingSettings screen={screen} />
      <ProspectingEmails screen={screen} />
    </main>
  );
}
