import { redirect } from "next/navigation";

import { InboxWorkspace } from "@/app/inbox/inbox-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EmailAgentPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = { ...await searchParams, channels: "EMAIL" };
  let initial;
  try {
    initial = await getOmnichannelService().getInbox(context, params);
    if (initial.selected && initial.selected.channel !== "EMAIL") {
      const emailParams = { ...params, conversationId: undefined };
      initial = await getOmnichannelService().getInbox(context, emailParams);
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        eyebrow="Negócios · comunicação"
        title="Email Agente"
        description="Acompanhe, organize e responda as conversas comerciais por e-mail em uma fila dedicada."
        meta={`Atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(initial.generatedAt))}`}
      />
      <InboxWorkspace
        basePath="/email-agente"
        initial={initial}
        key={`${initial.generatedAt}:${initial.query.view}:${initial.query.conversationId ?? "none"}`}
        lockedChannel="EMAIL"
      />
    </main>
  );
}
