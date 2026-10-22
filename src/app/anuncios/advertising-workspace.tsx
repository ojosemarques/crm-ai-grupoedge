import Link from "next/link";

import styles from "@/app/email-agente/prospecting-workspace.module.css";
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
          <table className={styles.table}><thead><tr><th>Lead</th><th>Etapa</th><th>Responsável</th><th>Prioridade</th><th>Entrada</th></tr></thead><tbody>
            {screen.stock.items.map((lead) => <tr key={lead.id}><td><Link className={styles.link} href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link><br />{lead.jobTitle ?? lead.organizationName ?? "—"}</td><td>{lead.currentStage.name}</td><td>{lead.owner?.name ?? "Sem responsável"}</td><td>{lead.priority}</td><td>{formatDate(lead.createdAt, screen.timeZone)}</td></tr>)}
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

export function AdvertisingMetrics({ screen }: Readonly<{ screen: Screen }>) {
  const selected = screen.metrics.period;
  const metrics = screen.metrics.totals;
  const cards = [
    ["Leads recebidos", metrics.leadsReceived],
    ["Ligações realizadas", metrics.calls],
    ["Ligações atendidas", metrics.callsConnected],
    ["Ligações sem atendimento", metrics.callsUnanswered],
    ["Falhas no número", metrics.callsFailed],
    ["Mensagens WhatsApp", metrics.whatsappSent],
    ["Sem WhatsApp", metrics.whatsappUnavailable],
    ["Mensagens Instagram", metrics.instagramMessages],
    ["Perfis seguidos", metrics.instagramFollows],
    ["Reuniões agendadas", metrics.meetingsScheduled],
    ["Reuniões realizadas", metrics.meetingsCompleted],
    ["Propostas", metrics.proposals],
    ["Vendas", metrics.sales],
    ["Receita vendida", money(metrics.revenueCents)],
  ] as const;
  return (
    <>
      <div className={styles.sectionHeader}><div><h2>Indicadores de Anúncios</h2><p>Fatos comerciais restritos aos leads deste pipeline.</p></div><Link className={styles.link} href="/dashboard">Abrir Indicadores gerais</Link></div>
      <section aria-label="Filtro de período das métricas" className={`${styles.card} ${styles.periodFilter}`}>
        <div><strong>Período das métricas</strong><p>{periodLabels[selected.preset] ?? "Período"} · {localDate(selected.fromDate)} a {localDate(selected.toDate)}</p></div>
        <nav aria-label="Atalhos de período" className={styles.periodNav}>{periodShortcuts.map(([preset, label]) => <Link aria-current={selected.preset === preset ? "page" : undefined} className={styles.periodLink} data-active={selected.preset === preset} href={`/anuncios?view=metrics&metricsPreset=${preset}`} key={preset}>{label}</Link>)}</nav>
        <form className={styles.customPeriodForm} method="get"><input name="view" type="hidden" value="metrics" /><input name="metricsPreset" type="hidden" value="CUSTOM" /><label>De<input defaultValue={selected.fromDate} max={screen.today} name="metricsFrom" required type="date" /></label><label>Até<input defaultValue={selected.toDate} max={screen.today} name="metricsTo" required type="date" /></label><button className={styles.button} type="submit">Personalizar</button></form>
      </section>
      <div className={styles.grid}>{cards.map(([label, value]) => <article className={styles.card} key={label}><h2>{label}</h2><div className={styles.metric}>{value}</div><p>No período selecionado</p></article>)}</div>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>Produção por responsável</h2><p>Métricas atribuídas aos vendedores no período selecionado.</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Responsável</th><th>Leads</th><th>Ligações</th><th>Atendidas</th><th>WhatsApp</th><th>Instagram</th><th>Seguidos</th><th>Reuniões</th><th>Realizadas</th><th>Propostas</th><th>Vendas</th></tr></thead><tbody>
            {screen.metrics.bySeller.map((row) => <tr key={row.memberId}><td>{row.memberName}</td><td>{row.leadsReceived}</td><td>{row.calls}</td><td>{row.callsConnected}</td><td>{row.whatsappSent}</td><td>{row.instagramMessages}</td><td>{row.instagramFollows}</td><td>{row.meetingsScheduled}</td><td>{row.meetingsCompleted}</td><td>{row.proposals}</td><td>{row.sales}</td></tr>)}
          </tbody></table>
          {screen.metrics.bySeller.length === 0 ? <p className={styles.empty}>Nenhuma métrica registrada no pipeline de Anúncios.</p> : null}
        </div>
      </section>
    </>
  );
}
