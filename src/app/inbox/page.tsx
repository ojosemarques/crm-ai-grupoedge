import { redirect } from "next/navigation";

import { InboxWorkspace } from "@/app/inbox/inbox-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  let initial;
  try {
    initial = await getOmnichannelService().getInbox(context, await searchParams);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        eyebrow="Conversas"
        title="Atendimento"
        description="Todas as conversas, em um só lugar."
        meta={`Atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(initial.generatedAt))}`}
      />
      <InboxWorkspace key={`${initial.generatedAt}:${initial.query.view}:${initial.query.conversationId ?? "none"}`} initial={initial} />
    </main>
  );
}
