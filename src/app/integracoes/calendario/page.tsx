import { redirect } from "next/navigation";

import { CalendarWorkspace } from "@/app/integracoes/calendario/calendar-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCalendarService } from "@/modules/integrations/application/calendar-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function CalendarIntegrationPage({ searchParams }: Readonly<{ searchParams: Promise<{ meetingId?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let initial;
  try { initial = await getCalendarService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · agenda" title="Calendário" description="Projeção bidirecional exercitada somente no sandbox local. A reunião e o histórico do CRM continuam sendo a fonte oficial." />
    <CalendarWorkspace initial={initial} initialMeetingId={query.meetingId ?? ""} />
  </main>;
}
