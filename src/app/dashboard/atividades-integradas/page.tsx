import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell, StatCard } from "@/components/ui/surface";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMetricsService } from "@/modules/metrics/application/metrics-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const filterKeys = [
  "sdrMemberIds", "closerMemberIds", "teamIds", "sourceIds", "campaignIds", "creativeIds",
  "priorityCodes", "productIds", "pipelineIds", "stageIds", "channels", "municipality",
  "stateCodes", "politicalRoles", "cadenceStepKeys", "executionModes",
] as const;

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function nextPageHref(params: Record<string, string | string[] | undefined>, cursor: string) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "cursor") continue;
    for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(key, item);
  }
  query.set("cursor", cursor);
  return `/dashboard/atividades-integradas?${query.toString()}`;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dashboardHref(params: Record<string, string | string[] | undefined>, timeZone: string, from: string, to: string) {
  const date = (value: string) => new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const query = new URLSearchParams({
    preset: "CUSTOM", fromDate: date(from), toDate: date(new Date(new Date(to).getTime() - 1).toISOString()),
  });
  const mappings = {
    sdrMemberIds: "sdr", closerMemberIds: "closer", teamIds: "team", sourceIds: "source",
    campaignIds: "campaign", creativeIds: "creative", priorityCodes: "priority", productIds: "product",
  } as const;
  for (const [source, target] of Object.entries(mappings)) {
    const value = params[source];
    for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(target, item);
  }
  return `/dashboard?${query.toString()}`;
}

function formatResult(value: string | null) {
  if (!value) return "—";
  const labels: Record<string, string> = {
    CONNECTED: "Atendida", NOT_CONNECTED: "Sem atendimento", NO_ANSWER: "Não atendeu", BUSY: "Ocupado",
    VOICEMAIL: "Caixa postal", WRONG_NUMBER: "Número incorreto", CHANNEL_UNAVAILABLE: "Canal indisponível",
    CALLBACK_REQUESTED: "Pediu retorno", WHATSAPP_SHARED: "Passou WhatsApp", SENT: "Enviado",
    COMPLETED: "Concluído", PROFILE_NOT_FOUND: "Perfil não encontrado", ALREADY_FOLLOWING: "Já seguia",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function formatMoney(value: string | null) {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(BigInt(value)) / 100);
}

function formatEvent(value: string) {
  const labels: Record<string, string> = {
    CALL_ATTEMPTED: "Ligação realizada", CALL_CONNECTED: "Ligação atendida", CALL_UNANSWERED: "Ligação sem atendimento", CALL_FAILED: "Ligação com falha",
    INSTAGRAM_MESSAGE_SENT: "Mensagem no Instagram", INSTAGRAM_FOLLOW_COMPLETED: "Perfil seguido",
    MEETING_SCHEDULED: "Reunião agendada", MEETING_COMPLETED: "Reunião realizada", LEAD_QUALIFIED: "Lead qualificado",
    TASK_CREATED: "Tarefa criada", TASK_COMPLETED: "Tarefa concluída", TASK_CANCELLED: "Tarefa cancelada",
    EMAIL_SENT: "E-mail enviado", SALE_WON: "Venda registrada", STAGE_ENTERED: "Entrada em etapa", STAGE_EXITED: "Saída de etapa",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

export default async function IntegratedActivityRecordsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let result;
  try {
    result = await getMetricsService().getIntegratedDrilldown(context, {
      metricId: single(params.metricId),
      query: {
        from: single(params.from),
        to: single(params.to),
        filters: Object.fromEntries(filterKeys.map((key) => {
          const value = params[key];
          return [key, Array.isArray(value) ? value : value ? [value] : []];
        })),
      },
      ...(single(params.cursor) ? { cursor: single(params.cursor) } : {}),
      limit: 50,
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return (
        <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
          <section className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-950">
            <h1 className="text-2xl font-bold">Recorte inválido</h1>
            <p className="mt-2 text-sm">{error.message}</p>
            <Link className="mt-4 inline-block font-semibold underline" href="/dashboard">Voltar aos indicadores</Link>
          </section>
        </main>
      );
    }
    throw error;
  }

  const memberIds = [...new Set(result.records
    .flatMap((record) => [record.creditedMemberId, record.performedByMemberId])
    .filter((id): id is string => id !== null))];
  const database = getDatabaseClient();
  const [workspace, members] = await Promise.all([
    database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
    memberIds.length ? database.workspaceMember.findMany({
      where: { workspaceId: context.workspaceId, id: { in: memberIds } },
      select: { id: true, user: { select: { displayName: true } } },
    }) : Promise.resolve([]),
  ]);
  const names = new Map(members.map((member) => [member.id, member.user.displayName]));
  const period = `${formatDate(result.period.from, workspace.timeZone)} até ${formatDate(result.period.to, workspace.timeZone)}`;
  const backHref = dashboardHref(params, workspace.timeZone, result.period.from, result.period.to);

  return (
    <main className="page-canvas">
      <PageHeader back={{ href: backHref, label: "Voltar aos indicadores com os mesmos filtros" }} description={result.metric.description} eyebrow="Log comercial" title={result.metric.label} />
      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard hint={workspace.timeZone} label="Período" tone="info" value={period} />
        <StatCard label="Registros nesta página" value={result.records.length} />
        <StatCard label="Escopo" value={result.scope === "WORKSPACE" ? "Todo o workspace" : result.scope === "TEAM" ? "Minha equipe" : "Meus registros"} />
      </section>
      {result.records.length === 0 ? (
        <EmptyState description="Não há fatos registrados para este período e estes filtros." title="Nenhum registro neste recorte" />
      ) : (
        <DataTableShell>
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead className="bg-muted text-left"><tr>
              <th className="p-3">Quando</th><th className="p-3">Vendedor</th><th className="p-3">Atividade</th>
              <th className="p-3">Resultado</th><th className="p-3">Canal</th><th className="p-3">Quantidade</th>
              <th className="p-3">Valor</th><th className="p-3">Registro</th>
            </tr></thead>
            <tbody>{result.records.map((record) => (
              <tr className="border-t" key={record.id}>
                <td className="p-3 whitespace-nowrap">{formatDate(record.occurredAt, workspace.timeZone)}</td>
                <td className="p-3">
                  {record.creditedMemberId ? names.get(record.creditedMemberId) ?? "Responsável não encontrado" : "Sem atribuição"}
                  {record.performedByMemberId && record.performedByMemberId !== record.creditedMemberId ? (
                    <small className="block text-muted-foreground">Executado por {names.get(record.performedByMemberId) ?? "membro não encontrado"}</small>
                  ) : null}
                </td>
                <td className="p-3"><strong className="block">{formatEvent(record.eventType)}</strong><small className="text-muted-foreground">{record.sourceEntityType}{record.taskKind ? ` · ${record.taskKind}` : ""}</small></td>
                <td className="p-3">{formatResult(record.result)}</td>
                <td className="p-3">{record.channel ?? "—"}</td>
                <td className="p-3 tabular-nums">{record.quantity.toLocaleString("pt-BR")}</td>
                <td className="p-3 tabular-nums">{formatMoney(record.valueCents)}</td>
                <td className="p-3">
                  {record.leadId ? <Link className="text-link font-semibold" href={`/leads/${record.leadId}/historico`}>Abrir lead</Link>
                    : record.meetingId ? <Link className="text-link font-semibold" href={`/agenda/reunioes/${record.meetingId}`}>Abrir reunião</Link> : "—"}
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary>Rastro do evento</summary>
                    <code className="break-all">{record.eventKey}</code>
                    <code className="block break-all">{record.sourceEntityType}: {record.sourceEntityId}</code>
                  </details>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </DataTableShell>
      )}
      {result.limitations.length > 0 ? <p className="mt-4 text-sm text-muted-foreground">{result.limitations.join(" ")}</p> : null}
      {result.nextCursor ? <nav aria-label="Paginação do log" className="mt-5"><Link className="rounded-md border px-3 py-2 text-sm font-semibold" href={nextPageHref(params, result.nextCursor)}>Próximos registros</Link></nav> : null}
    </main>
  );
}
