import { getDatabaseClient } from "@/shared/core/database/client";
import { workspaceDayRange } from "@/shared/core/time/workspace-time";
import { activityTypeLabels, activityResultLabels } from "@/modules/activities/domain/activity-display";
import Link from "next/link";
import { ActivityResult, ActivityType } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getCommercialHistoryService } from "@/modules/activities/application/commercial-history-service";
import styles from "@/app/email-agente/prospecting-workspace.module.css";

export async function CommercialHistory({ context, pipelineName, params, basePath }: Readonly<{
  context: AuthenticatedContext; pipelineName: "Anúncios" | "Prospecção Ativa";
  params: Record<string, string | string[] | undefined>; basePath: string;
}>) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const result = await getCommercialHistoryService().getHistory(context, {
    pipelineName, page: first(params.historyPage) ?? 1,
    ...(first(params.historyType) ? { type: first(params.historyType) } : {}),
    ...(first(params.historyResult) ? { result: first(params.historyResult) } : {}),
    ...(first(params.historyFrom) ? { from: workspaceDayRange(first(params.historyFrom)!, workspace.timeZone).start } : {}),
    ...(first(params.historyTo) ? { to: workspaceDayRange(first(params.historyTo)!, workspace.timeZone).end } : {}),
  });
  const href = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, values] of Object.entries(params)) for (const value of Array.isArray(values) ? values : values ? [values] : []) search.append(key, value);
    search.set("view", "activities"); search.set("historyPage", String(page));
    return `${basePath}?${search}`;
  };
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <section className={styles.section} aria-label={`Histórico de ${pipelineName}`}>
    <header className={styles.sectionHeader}><div><h2>Histórico de eventos</h2><p>Ocorrências dos registros comerciais desta frente. Atribuições históricas dos indicadores ficam nos fatos auditáveis.</p></div></header>
    <form className={styles.customPeriodForm} method="get"><input name="view" type="hidden" value="activities" /><label>De<input type="date" name="historyFrom" defaultValue={first(params.historyFrom) ?? ""} /></label><label>Até<input type="date" name="historyTo" defaultValue={first(params.historyTo) ?? ""} /></label><label>Tipo<select defaultValue={first(params.historyType) ?? ""} name="historyType"><option value="">Todos</option>{Object.values(ActivityType).map((type) => <option key={type} value={type}>{activityTypeLabels[type] ?? type}</option>)}</select></label><label>Resultado<select defaultValue={first(params.historyResult) ?? ""} name="historyResult"><option value="">Todos</option>{Object.values(ActivityResult).map((type) => <option key={type} value={type}>{activityResultLabels[type] ?? type}</option>)}</select></label><button className={styles.button}>Filtrar histórico</button></form>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Data</th><th>Lead / frente</th><th>Evento</th><th>Autor</th><th>Responsável atual</th><th>Resultado</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.id}><td>{new Intl.DateTimeFormat("pt-BR", { timeZone: workspace.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(item.occurredAt))}</td><td><Link className={styles.link} href={`/leads/${item.lead.id}/historico`}>{item.lead.fullName}</Link><br />{item.lead.pipeline.name}</td><td>{item.subject}<br />{activityTypeLabels[item.type] ?? item.type}</td><td>{item.createdBy.displayName}</td><td>{item.lead.owner?.user.displayName ?? "Sem responsável"}</td><td>{item.result ? activityResultLabels[item.result] ?? item.result : "Sem resultado informado"}</td></tr>)}</tbody></table>{!result.items.length ? <p className={styles.empty}>Nenhum evento neste recorte.</p> : null}</div>
    <nav aria-label="Páginas do histórico" className={styles.sectionHeader}>{result.page > 1 ? <Link href={href(result.page - 1)}>Anterior</Link> : <span />}<span>{result.total} evento(s) · página {result.page} de {pages}</span>{result.page < pages ? <Link href={href(result.page + 1)}>Próxima</Link> : null}</nav>
  </section>;
}
