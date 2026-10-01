import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCompanySetupService } from "@/modules/users/application/company-setup-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { CompanySetupAssistant } from "./company-setup-assistant";

export const dynamic = "force-dynamic";

export default async function CompanySetupPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getCompanySetupService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Primeiros passos" title={`Configure ${initial.workspace.name}`} description="Prepare a empresa para a equipe começar a vender. O progresso é salvo e atualizado a partir da configuração real do CRM." meta={context.displayName} />
    <CompanySetupAssistant initial={initial} />
  </main>;
}
