import { redirect } from "next/navigation";

import { CalendarWorkspace } from "@/app/integracoes/calendario/calendar-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getGoogleCalendarService } from "@/modules/integrations/application/google-calendar-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function CalendarIntegrationPage({ searchParams }: Readonly<{ searchParams: Promise<{ google?: string; code?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let initial;
  try { initial = await getGoogleCalendarService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Configurações · Integrações" title="Google Calendar" description="Conecte a agenda de cada vendedor e sincronize reuniões criadas no CRM." />
    <CalendarWorkspace callbackCode={query.code} callbackStatus={query.google} initial={initial} />
  </main>;
}
