import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Configurações" title="Integrações" description="Infraestrutura governada para conexões, referências de segredo, sincronização e mapeamentos." actions={<div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link href="/integracoes/n8n">Abrir sandbox n8n</Link></Button><Button asChild variant="secondary"><Link href="/integracoes/meta-ads">Configurar Meta Ads</Link></Button><Button asChild variant="secondary"><Link href="/integracoes/google-ads">Configurar Google Ads</Link></Button><Button asChild variant="secondary"><Link href="/integracoes/whatsapp">Configurar WhatsApp</Link></Button><Button asChild variant="secondary"><Link href="/integracoes/telefonia">Abrir Telefonia</Link></Button><Button asChild><Link href="/integracoes/calendario">Abrir Calendário</Link></Button></div>} /><IntegrationsWorkspace initial={initial} /></main>;
}
