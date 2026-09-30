import { redirect } from "next/navigation";

import { AssistantWorkspace, type AssistantScreen } from "@/app/assistente/assistant-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAssistantService } from "@/modules/ai-assistant/application/assistant-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const context = await requirePageAuthentication();
  let screen: AssistantScreen;
  try {
    screen = await getAssistantService().screen(context) as unknown as AssistantScreen;
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader description="Consulte dados autorizados e prepare configurações em rascunho com diff, impacto, aprovação administrativa e undo." eyebrow="IA explicável" meta={context.displayName} title="Assistente operacional" />
    <AssistantWorkspace initial={screen} />
  </main>;
}
