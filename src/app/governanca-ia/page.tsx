import { redirect } from "next/navigation";

import { AIGovernanceWorkspace } from "@/app/governanca-ia/ai-governance-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAIGovernanceService } from "@/modules/ai/application/ai-governance-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

async function loadGovernanceScreen(context: Awaited<ReturnType<typeof requirePageAuthentication>>) {
  try {
    return await getAIGovernanceService().getScreen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
}

export default async function AIGovernancePage() {
  const context = await requirePageAuthentication();
  const screen = await loadGovernanceScreen(context);
  return (
    <main className="page-canvas">
      <PageHeader
        description="Versões aprovadas, avaliações locais, decisões humanas e observabilidade sem expor payloads sensíveis."
        eyebrow="Governança"
        meta={`${context.displayName} · ${screen.mode}`}
        title="Governança de IA"
      />
      <AIGovernanceWorkspace initialScreen={screen} roleKey={context.roleKey} />
    </main>
  );
}
