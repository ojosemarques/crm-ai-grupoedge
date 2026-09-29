import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PrivacyWorkspace } from "@/app/privacidade/privacy-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const context = await requirePageAuthentication();
  let screen: Awaited<ReturnType<ReturnType<typeof getPrivacyService>["getScreen"]>>;
  try {
    screen = await getPrivacyService().getScreen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        eyebrow="Governança de dados"
        title="Privacidade e retenção"
        description="Finalidades versionadas, consentimentos por canal, solicitações de titulares e retenção com revisão humana."
        meta={`Atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(screen.generatedAt))}`}
      />
      <PrivacyWorkspace initial={screen} />
    </main>
  );
}
