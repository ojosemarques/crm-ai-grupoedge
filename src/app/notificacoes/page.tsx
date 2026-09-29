import Link from "next/link";

import { NotificationCenter } from "@/app/automacoes/notification-center";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getNotificationService } from "@/modules/automations/application/notification-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const screen = await getNotificationService().list(context, await searchParams);
  return <main className="page-canvas"><PageHeader description="Avisos persistidos destinados a você, isolados por workspace." eyebrow="Central operacional" meta={context.displayName} title="Minhas notificações" /><nav className="mb-5 inline-flex flex-wrap gap-1 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-1" aria-label="Filtro de notificações"><Link className="rounded-md px-3 py-2 text-sm font-medium hover:bg-card" href="/notificacoes?status=ALL">Todas</Link><Link className="rounded-md px-3 py-2 text-sm font-medium hover:bg-card" href="/notificacoes?status=UNREAD">Não lidas</Link><Link className="rounded-md px-3 py-2 text-sm font-medium hover:bg-card" href="/notificacoes?status=READ">Lidas</Link></nav><NotificationCenter initialScreen={screen} /></main>;
}
