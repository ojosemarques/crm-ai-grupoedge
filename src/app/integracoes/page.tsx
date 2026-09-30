import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getIntegrationPlatformService } from "@/modules/integrations/application/integration-platform-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { IntegrationsWorkspace } from "@/app/integracoes/integrations-workspace";
export const dynamic = "force-dynamic";
export default async function IntegrationsPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getIntegrationPlatformService().list(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Configurações" title="Integrações" description="Gerencie os canais e acompanhe o estado de cada conexão." /><IntegrationsWorkspace initial={initial} /></main>;
}
