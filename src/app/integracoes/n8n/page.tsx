import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { N8nWorkspace } from "@/app/integracoes/n8n/n8n-workspace";
export const dynamic = "force-dynamic";
export default async function N8nPage() {
  const context = await requirePageAuthentication(); let initial;
  try { initial = await getN8nGovernanceService().list(context); } catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Integrações" title="Extensibilidade n8n" description="Contratos versionados, identidades de máquina e propostas revisáveis em ambiente estritamente local." /><N8nWorkspace initial={initial} /></main>;
}
