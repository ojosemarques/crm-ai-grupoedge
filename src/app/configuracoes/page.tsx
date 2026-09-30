import { redirect } from "next/navigation";

import { CommercialSettingsWorkspace } from "@/app/configuracoes/commercial-settings-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCommercialSettingsService } from "@/modules/settings/application/commercial-settings-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getCommercialSettingsService().getScreen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return (
    <main className="page-canvas">
      <PageHeader description="Personalize sua operação, seus produtos e a jornada comercial." eyebrow="Administração" meta={context.displayName} title="Configurações" />
      <CommercialSettingsWorkspace initialScreen={screen} />
    </main>
  );
}
