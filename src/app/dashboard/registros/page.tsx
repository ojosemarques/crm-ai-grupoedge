import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell, StatCard } from "@/components/ui/surface";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import type { DashboardQuery } from "@/modules/metrics/domain/dashboard-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function queryParams(query: DashboardQuery, extras: Record<string, string> = {}) {
  const params = new URLSearchParams({ preset: query.preset, fromDate: query.fromDate, toDate: query.toDate, ...extras });
  const mappings = [
    ["sdr", query.filters.sdrMemberIds], ["closer", query.filters.closerMemberIds], ["team", query.filters.teamIds],
    ["source", query.filters.sourceIds], ["campaign", query.filters.campaignIds], ["creative", query.filters.creativeIds],
    ["priority", query.filters.priorityCodes], ["product", query.filters.productIds],
  ] as const;
  for (const [name, values] of mappings) for (const value of values) params.append(name, value);
  return params;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatMoney(value: string | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(BigInt(value)) / 100);
}

export default async function DashboardRecordsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let result;
  try {
    result = await getDashboardMetricsService().getDrilldown(context, params);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16"><section className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-950"><h1 className="text-2xl font-bold">Drilldown inválido</h1><p className="mt-2 text-sm">{error.message}</p><Link className="mt-4 inline-block font-semibold underline" href="/dashboard">Voltar ao dashboard</Link></section></main>;
    }
    throw error;
  }
  const dashboardLink = `/dashboard?${queryParams(result.query).toString()}`;
  const paginationLink = (page: number) => `/dashboard/registros?${queryParams(result.query, { view: result.drilldown.id, page: String(page), pageSize: String(result.pageSize) }).toString()}`;
  return (
    <main className="page-canvas">
      <PageHeader back={{ href: dashboardLink, label: "Voltar ao dashboard com os mesmos filtros" }} description={result.drilldown.description} eyebrow="Drilldown reconciliável" title={result.drilldown.title} />
      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard hint={result.timeZone} label="Período" tone="info" value={`${result.period.fromDate} a ${result.period.toDate}`} />
        <StatCard compactValue label="Fórmula" value={result.drilldown.formula} />
        <StatCard label="Registros" tone="info" value={result.total} />
        <StatCard hint={result.timeZone} label="Última atualização" value={formatDate(result.generatedAt, result.timeZone)} />
      </section>
      {result.records.length === 0 ? (
        <EmptyState description="O resultado zero é real para o período e os filtros informados." title="Nenhum registro neste recorte" />
      ) : (
        <DataTableShell><table className="w-full min-w-[900px] border-collapse text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">Registro</th><th className="p-3">Tipo</th><th className="p-3">Responsável</th><th className="p-3">Estado</th><th className="p-3">Valor</th><th className="p-3">Data/hora</th><th className="p-3">Ação</th></tr></thead><tbody>{result.records.map((record) => <tr className="border-t" key={record.key}><td className="p-3"><strong className="block">{record.title}</strong><span className="text-xs text-muted-foreground">{record.subtitle}</span></td><td className="p-3">{record.entityType}</td><td className="p-3">{record.responsibleName ?? "—"}</td><td className="p-3">{record.status ?? "—"}</td><td className="p-3 tabular-nums">{formatMoney(record.amountCents)}</td><td className="p-3">{formatDate(record.occurredAt, result.timeZone)}</td><td className="p-3"><Link className="text-link font-semibold" href={record.href}>Abrir</Link></td></tr>)}</tbody></table></DataTableShell>
      )}
      <nav className="mt-5 flex items-center justify-between" aria-label="Paginação do drilldown"><span className="text-sm text-muted-foreground">Página {result.page} de {result.totalPages}</span><div className="flex gap-2">{result.page > 1 ? <Link className="rounded-md border px-3 py-2 text-sm font-semibold" href={paginationLink(result.page - 1)}>Anterior</Link> : null}{result.page < result.totalPages ? <Link className="rounded-md border px-3 py-2 text-sm font-semibold" href={paginationLink(result.page + 1)}>Próxima</Link> : null}</div></nav>
    </main>
  );
}
