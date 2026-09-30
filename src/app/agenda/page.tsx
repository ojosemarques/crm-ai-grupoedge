import { redirect } from "next/navigation";

import { AgendaWorkspace } from "@/app/agenda/agenda-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function AgendaPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  try {
    screen = await getMeetingService().getAgenda(context, {
      view: first(params.view),
      date: first(params.date),
      closerId: first(params.closerId),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return (
    <main className="page-canvas">
      <PageHeader
        description="Suas reuniões e atividades, em um só calendário."
        eyebrow="Agenda do closer"
        meta={`Dados exibidos em ${screen.timeZone}`}
        title="Agenda"
      />
      <AgendaWorkspace initialScreen={screen} />
    </main>
  );
}
