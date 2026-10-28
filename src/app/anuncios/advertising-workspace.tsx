import Link from "next/link";

import styles from "@/app/email-agente/prospecting-workspace.module.css";
import { LeadFormResponseDetails } from "@/components/leads/lead-form-response-details";
import type { getAdvertisingWorkspaceService } from "@/modules/advertising/application/advertising-workspace-service";

export const advertisingViews = ["pipeline", "stock", "activities", "metrics"] as const;
export type AdvertisingView = (typeof advertisingViews)[number];
type Screen = Awaited<ReturnType<ReturnType<typeof getAdvertisingWorkspaceService>["getScreen"]>>;

const labels: Record<AdvertisingView, string> = {
  pipeline: "Pipeline",
  stock: "Estoque",
  activities: "Atividades",
  metrics: "Métricas",
};
const periodLabels: Readonly<Record<string, string>> = {
  TODAY: "Hoje",
  YESTERDAY: "Ontem",
  LAST_7_DAYS: "Últimos 7 dias",
  MONTH: "Este mês",
  LAST_30_DAYS: "Últimos 30 dias",
  CUSTOM: "Personalizado",
};
const periodShortcuts = [["TODAY", "Hoje"], ["YESTERDAY", "Ontem"], ["LAST_7_DAYS", "7 dias"], ["MONTH", "Mês"], ["LAST_30_DAYS", "30 dias"]] as const;

function formatDate(value: string | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function localDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function money(value: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}

export function AdvertisingNav({ active }: Readonly<{ active: AdvertisingView }>) {
  return (
    <nav aria-label="Áreas de Anúncios" className={styles.tabs}>
      {advertisingViews.map((view) => (
        <Link data-active={view === active} href={`/anuncios?view=${view}`} key={view}>{labels[view]}</Link>
      ))}
    </nav>
  );
}

export function AdvertisingStock({ screen }: Readonly<{ screen: Screen }>) {
  const pages = Math.max(1, Math.ceil(screen.stock.total / screen.stock.pageSize));
  return (
    <>
      <div className={styles.grid}>
        <article className={styles.card}><h2>Leads no estoque</h2><div className={styles.metric}>{screen.stock.total}</div><p>Somente leads vinculados ao pipeline de Anúncios.</p></article>
        {screen.pipeline.stages.map((stage) => <article className={styles.card} key={stage.id}><h3>{stage.name}</h3><div className={styles.metric}>{stage.leads}</div><p>card(s) nesta etapa</p></article>)}
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>Estoque de Anúncios</h2><p>{screen.stock.total} lead(s) · página {screen.stock.page} de {pages}</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Lead</th><th>Telefone</th><th>Respostas</th><th>Etapa</th><th>Responsável</th><th>Prioridade</th><th>Entrada</th></tr></thead><tbody>
            {screen.stock.items.map((lead) => <tr key={lead.id}><td><Link className={styles.link} href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link><br />{lead.jobTitle ?? lead.organizationName ?? "—"}</td><td>{lead.phone ?? "—"}</td><td><LeadFormResponseDetails responses={lead.formResponses} timeZone={screen.timeZone} /></td><td>{lead.currentStage.name}</td><td>{lead.owner?.name ?? "Sem responsável"}</td><td>{lead.priority}</td><td>{formatDate(lead.createdAt, screen.timeZone)}</td></tr>)}
          </tbody></table>
          {screen.stock.items.length === 0 ? <p className={styles.empty}>O pipeline de Anúncios está vazio.</p> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: ".7rem" }}>
          {screen.stock.page > 1 ? <Link className={styles.link} href={`/anuncios?view=stock&page=${screen.stock.page - 1}`}>Anterior</Link> : <span />}
          {screen.stock.page < pages ? <Link className={styles.link} href={`/anuncios?view=stock&page=${screen.stock.page + 1}`}>Próxima</Link> : null}
        </div>
      </section>
    </>
  );
}

export function AdvertisingActivities({ screen }: Readonly<{ screen: Screen }>) {
  const pages = Math.max(1, Math.ceil(screen.activities.total / screen.activities.pageSize));
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}><div><h2>Atividades de Anúncios</h2><p>Tarefas dos leads deste pipeline · página {screen.activities.page} de {pages}.</p></div><Link className={styles.link} href="/meu-dia">Abrir Meu Dia</Link></div>
      <div className={styles.tableWrap}>
        <table className={styles.table}><thead><tr><th>Prazo</th><th>Lead</th><th>Atividade</th><th>Responsável</th><th>Status</th><th>Resultado</th></tr></thead><tbody>
          {screen.activities.items.map((task) => <tr key={task.id}><td>{formatDate(task.dueAt, screen.timeZone)}</td><td><Link className={styles.link} href={`/leads/${task.lead.id}/historico`}>{task.lead.fullName}</Link></td><td>{task.title}<br />{task.kind}</td><td>{task.assignee?.name ?? "Sem responsável"}</td><td>{task.status}</td><td>{task.result ?? "—"}</td></tr>)}
        </tbody></table>
        {screen.activities.items.length === 0 ? <p className={styles.empty}>Nenhuma atividade no pipeline de Anúncios.</p> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: ".7rem" }}>
        {screen.activities.page > 1 ? <Link className={styles.link} href={`/anuncios?view=activities&activityPage=${screen.activities.page - 1}`}>Anterior</Link> : <span />}
        {screen.activities.page < pages ? <Link className={styles.link} href={`/anuncios?view=activities&activityPage=${screen.activities.page + 1}`}>Próxima</Link> : null}
      </div>
    </section>
  );
}

const commercialMetrics = [
  ["effectiveContacts", "Contatos efetivos"], ["calls", "Ligações"], ["messages", "Mensagens enviadas"],
  ["meetingsScheduled", "Reuniões marcadas"], ["meetingsCompleted", "Reuniões realizadas"], ["sales", "Vendas"],
] as const;

export function AdvertisingMetrics({ screen }: Readonly<{ screen: Screen }>) {
  const selected = screen.metrics.period;
  const metrics = screen.metrics.totals;
  const live = screen.metrics.live;
  const goal = live.week.goals.sales;
  const cards = [
    ["Leads Anúncios", metrics.leadsReceived], ["Contatos efetivos", metrics.effectiveContacts],
    ["Ligações", metrics.calls], ["Mensagens enviadas", metrics.messages],
    ["Reuniões agendadas", metrics.meetingsScheduled], ["Reuniões feitas", metrics.meetingsCompleted],
    ["Vendas", metrics.sales], ["Receita vendida", money(metrics.revenueCents)],
  ] as const;
  const summary = [
    ["Leads hoje", live.today.leadsReceived ?? 0, "Leads únicos recebidos de anúncios hoje"],
    ["Reuniões agendadas", live.today.totals.meetingsScheduled, `${live.week.totals.meetingsScheduled} na semana`],
    ["Reuniões feitas", live.today.totals.meetingsCompleted, `${live.week.totals.meetingsCompleted} na semana`],
    ["Meta semanal de vendas", `${live.week.totals.sales} / ${goal.targetValue ?? "não definida"}`, goal.label],
  ] as const;
  return (
    <>
      <div className={styles.sectionHeader}><div><h2>Indicadores de Anúncios</h2><p>Entradas e atividades de anúncios, atualizadas automaticamente.</p></div><Link className={styles.link} href="/dashboard/anuncios">Abrir Visão Geral — Anúncios</Link></div>
      <section className={styles.grid} aria-label="Resumo ao vivo de Anúncios">{summary.map(([label, value, detail]) => <article className={styles.card} key={label}><h2>{label}</h2><div className={styles.metric}>{value}</div><p>{detail}</p></article>)}</section>
      <section aria-label="Filtro de período das métricas" className={`${styles.card} ${styles.periodFilter}`}>
        <div><strong>Período das métricas</strong><p>{periodLabels[selected.preset] ?? "Período"} · {localDate(selected.fromDate)} a {localDate(selected.toDate)}</p></div>
        <nav aria-label="Atalhos de período" className={styles.periodNav}>{periodShortcuts.map(([preset, label]) => <Link aria-current={selected.preset === preset ? "page" : undefined} className={styles.periodLink} data-active={selected.preset === preset} href={`/anuncios?view=metrics&metricsPreset=${preset}`} key={preset}>{label}</Link>)}</nav>
        <form className={styles.customPeriodForm} method="get"><input name="view" type="hidden" value="metrics" /><input name="metricsPreset" type="hidden" value="CUSTOM" /><label>De<input defaultValue={selected.fromDate} max={screen.today} name="metricsFrom" required type="date" /></label><label>Até<input defaultValue={selected.toDate} max={screen.today} name="metricsTo" required type="date" /></label><button className={styles.button} type="submit">Personalizar</button></form>
      </section>

      <section className={styles.grid} aria-label="Métricas do período de Anúncios">{cards.map(([label, value]) => <article className={styles.card} key={label}><h2>{label}</h2><div className={styles.metric}>{value}</div><p>No período selecionado</p></article>)}</section>
      <p>Contatos, ligações e mensagens consideram os leads recebidos no período selecionado. Mensagens somam os registros de envio; contatos contam cada lead uma única vez.</p>
      {(["today", "week"] as const).map(period => <section className={styles.section} aria-label={period === "today" ? "Metas diárias de Anúncios" : "Metas semanais de Anúncios"} key={period}>
        <div className={styles.sectionHeader}><div><h2>{period === "today" ? "Meta diária" : "Acumulado semanal"}</h2><p>{period === "today" ? "Leads recebidos hoje e resultados do dia." : "Leads recebidos na semana e resultados acumulados."}</p></div></div>
        <div className={styles.grid}>{commercialMetrics.map(([key, label]) => {
          const progress = live[period].goals[key];
          return <article className={styles.card} key={key}><h3>{label}</h3><div className={styles.metric}>{live[period].totals[key]}</div><p>{progress.targetValue === null ? progress.label : `${progress.actualValue} / ${progress.targetValue} · ${progress.label}`}</p></article>;
        })}</div>
      </section>)}
      <section className={styles.section} aria-label="Ranking e metas de Anúncios">
        <div className={styles.sectionHeader}><div><h2>Ranking e metas por responsável</h2><p>Carlos: agendar 50% dos leads recebidos. Jhon e Ede: realizar 60% das reuniões atribuídas a cada um. Frações são arredondadas para cima.</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Responsável</th>{commercialMetrics.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>
            {live.week.ranking.map(row => <tr key={row.position}><td>{row.name}<br /><small>{row.advertisingRole === "BOOKER" ? "Pré-vendas" : "Fechamento"}</small></td>{commercialMetrics.map(([key]) => <td key={key}>Hoje: {row.today[key]}{row.goals.today[key].targetValue !== null ? ` / ${row.goals.today[key].targetValue}` : ""}<br /><small>Semana: {row[key]}{row.goals.week[key].targetValue !== null ? ` / ${row.goals.week[key].targetValue}` : ""}</small></td>)}</tr>)}
          </tbody></table>
          {live.week.ranking.length === 0 ? <p className={styles.empty}>Nenhum profissional comercial neste período.</p> : null}
        </div>
      </section>
    </>
  );
}
