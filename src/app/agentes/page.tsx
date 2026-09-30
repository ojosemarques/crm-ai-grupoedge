import { redirect } from "next/navigation";

import { AgentBuilderWorkspace, type AgentsScreen } from "@/app/agentes/agent-builder-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getGovernedAgentService } from "@/modules/ai-agents/application/governed-agent-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const context = await requirePageAuthentication();
  let screen: AgentsScreen;
  try {
    screen = await getGovernedAgentService().screen(context) as unknown as AgentsScreen;
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader description="Defina, avalie e versione agentes e subagentes com base aprovada, orçamento, ferramentas permitidas e handoff humano." eyebrow="IA governada" meta={`${context.displayName} · ${screen.providerGate.mode}`} title="Construtor de agentes" />
    <AgentBuilderWorkspace initial={screen} />
  </main>;
}
