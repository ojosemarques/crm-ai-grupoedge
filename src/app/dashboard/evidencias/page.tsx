import Link from "next/link";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMetricsService } from "@/modules/metrics/application/metrics-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { PageHeader } from "@/components/layout/page-header";
import { commercialFrontPaths } from "@/modules/metrics/domain/commercial-front";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { redirect } from "next/navigation";
import { RouteAutoRefresh } from "@/components/layout/route-auto-refresh";

export const dynamic = "force-dynamic";
const filterKeys = ["sdrMemberIds", "closerMemberIds", "teamIds", "sourceIds", "campaignIds", "creativeIds", "priorityCodes", "productIds", "formIds", "pipelineIds", "stageIds", "channels"] as const;
const labels: Record<string, string> = { "time-first-action": "Tempo até primeira ação", "time-first-response": "Tempo até primeira resposta humana", "time-booking": "Tempo até agendamento", "time-result": "Tempo até primeiro resultado comercial", entries: "Entradas comerciais", participations: "Novas participações", people: "Pessoas nas novas participações", booked: "Reuniões agendadas", assigned: "Reuniões atribuídas no agendamento", completed: "Reuniões realizadas", "booking-cohort": "Agendamentos da coorte de entrada", "completion-cohort": "Realizações da coorte de agendamento" };

export default async function FrontEvidence({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  const first = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  let result;
  try {
    result = await getMetricsService().getCommercialFrontEvidence(context, {
      query: { from: first("from"), to: first("to"), filters: Object.fromEntries(filterKeys.map((key) => [key, Array.isArray(params[key]) ? params[key] : params[key] ? [params[key]] : []])) },
      measure: first("measure"), ...(first("memberId") ? { memberId: first("memberId") } : {}), page: first("page") ?? 1,
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") return <main className="page-canvas"><h1>Recorte inválido</h1><p>{error.message}</p><Link href="/dashboard">Voltar aos indicadores</Link></main>;
    throw error;
  }
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const date = (value: string, detail = false) => new Intl.DateTimeFormat(detail ? "pt-BR" : "sv-SE", detail ? { timeZone: workspace.timeZone, dateStyle: "short", timeStyle: "short" } : { timeZone: workspace.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const mode = first("mode");
  const base = mode === "ADVERTISING" || mode === "PROSPECTING" ? commercialFrontPaths[mode] : commercialFrontPaths.ALL;
  const back = new URLSearchParams({ preset: "CUSTOM", fromDate: date(result.query.from), toDate: date(new Date(new Date(result.query.to).getTime() - 1).toISOString()) });
  back.set("from", result.query.from);
  back.set("to", result.query.to);
  const mappings = { sdrMemberIds: "sdr", closerMemberIds: "closer", teamIds: "team", sourceIds: "source", campaignIds: "campaign", creativeIds: "creative", priorityCodes: "priority", productIds: "product", formIds: "form", pipelineIds: "pipeline", stageIds: "stage", channels: "channel" };
  for (const [source, target] of Object.entries(mappings)) for (const value of result.query.filters[source as keyof typeof result.query.filters] ?? []) back.append(target, value);
  const pageHref = (page: number) => { const next = new URLSearchParams(); for (const [key, value] of Object.entries(params)) for (const part of Array.isArray(value) ? value : value ? [value] : []) next.append(key, part); next.set("page", String(page)); return `/dashboard/evidencias?${next}`; };
  return <main className="page-canvas"><RouteAutoRefresh /><PageHeader back={{ href: `${base}?${back}`, label: "Voltar ao mesmo recorte" }} eyebrow="Evidências comerciais" title={labels[result.measure] ?? result.measure} description={`${result.total} registro(s) de evidência; saldo ${result.quantity}. Correções conservam quantidades assinadas.`} />
    <p className="mb-3 text-sm">{date(result.query.from, true)} até {date(result.query.to, true)} (fim exclusivo) · {workspace.timeZone}. Cada linha referencia o fato e seu registro de origem.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Data</th><th>Marco</th><th>Início / duração</th><th>Quantidade</th><th>Fato</th><th>Registro</th></tr></thead><tbody>{result.records.map((row) => <tr className="border-t" key={row.id}><td className="p-3">{date(row.occurredAt, true)}</td><td>{row.eventType}</td><td>{row.startedAt ? `${date(row.startedAt, true)} · ${row.durationSeconds}s` : "—"}</td><td>{row.quantity}</td><td>{row.id}</td><td>{row.leadId ? <Link className="text-link underline" href={`/leads/${row.leadId}/historico`}>Histórico do lead</Link> : "Sem lead vinculado"}{row.meetingId ? ` · reunião ${row.meetingId}` : ""}</td></tr>)}</tbody></table></div>
    {!result.records.length ? <p>Nenhuma evidência neste recorte.</p> : null}
    <nav aria-label="Páginas das evidências" className="mt-4 flex justify-between">{result.page > 1 ? <Link href={pageHref(result.page - 1)}>Anterior</Link> : <span />}<span>Página {result.page}</span>{result.page * result.pageSize < result.total ? <Link href={pageHref(result.page + 1)}>Próxima</Link> : null}</nav>
  </main>;
}
