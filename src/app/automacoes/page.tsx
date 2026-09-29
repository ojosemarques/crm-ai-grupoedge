import { redirect } from "next/navigation";

import { AutomationsWorkspace } from "@/app/automacoes/automations-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAutomationObservabilityService } from "@/modules/automations/application/automation-observability-service";
import { getNotificationService } from "@/modules/automations/application/notification-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AutomationsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let data: Awaited<
    ReturnType<typeof Promise.all<[ReturnType<ReturnType<typeof getAutomationObservabilityService>["getOverview"]>, ReturnType<ReturnType<typeof getNotificationService>["list"]>]>>
  >;
  try {
    data = await Promise.all([
      getAutomationObservabilityService().getOverview(context, params),
      getNotificationService().list(context, { status: "ALL", limit: 30 }),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  const [overview, notifications] = data;
  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader description="Regras predefinidas, execuções persistidas, erros visíveis e mensagens sempre identificadas como simulação." eyebrow="Operação local" meta={context.displayName} title="Automações locais" />
      <AutomationsWorkspace initialOverview={overview} notifications={notifications} />
    </main>
  );
}
