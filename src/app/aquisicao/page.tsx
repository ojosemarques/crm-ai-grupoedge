import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { AcquisitionWorkspace } from "@/app/aquisicao/acquisition-workspace";

export const dynamic = "force-dynamic";

export default async function AcquisitionPage() {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getMarketingAttributionService().getScreen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Revenue OS" title="Aquisição e atribuição" description="Entenda as origens dos contatos, acompanhe conversões e compare modelos de atribuição." />
    <AcquisitionWorkspace initial={screen} />
  </main>;
}
