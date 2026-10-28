import type { RealtimeDashboardFront } from "@/modules/realtime-dashboard/domain/realtime-dashboard-front";
import type { RealtimeDashboardGoals, RealtimeDashboardRankingRow, RealtimeDashboardSnapshot, RealtimeDashboardTotals, RealtimeGoalMetric, RealtimeGoalProgress } from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import { Avatar, Icon } from "./realtime-dashboard-icons";
import styles from "./realtime-dashboard.module.css";

export const number = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export function formatCents(value: string) { return money.format(Number(BigInt(value)) / 100); }
const date = (value: string) => value.split("-").reverse().slice(0, 2).join("/");
const metrics = [
  { key: "effectiveContacts", label: "Contatos efetivos", detail: "Pessoas únicas no período", icon: "people" },
  { key: "calls", label: "Ligações", detail: "Tentativas registradas", icon: "phone" },
  { key: "messages", label: "Mensagens enviadas", detail: "WhatsApp e Instagram", icon: "message" },
  { key: "meetingsScheduled", label: "Reuniões marcadas", detail: "Crédito de agendamento", icon: "calendar" },
  { key: "meetingsCompleted", label: "Reuniões realizadas", detail: "Concluídas no período", icon: "check" },
  { key: "sales", label: "Vendas", detail: "Oportunidades ganhas", icon: "sale" },
] as const;

function percent(goal: RealtimeGoalProgress) { return Math.max(0, Math.min(100, (goal.progressBasisPoints ?? 0) / 100)); }
function goalValue(value: string, metric?: RealtimeGoalMetric) { return metric === "salesValueCents" ? formatCents(value) : number.format(Number(value)); }

export function GoalMeter({ goal, metric, compact = false }: Readonly<{ goal: RealtimeGoalProgress; metric?: RealtimeGoalMetric; compact?: boolean }>) {
  const configured = goal.targetValue !== null && BigInt(goal.targetValue) > 0n;
  const compactLabel = metric === "messages" ? "Meta WA/IG" : goal.source === "DAILY_PROFILE_X5" ? metric === "effectiveContacts" ? "Contatos-dia" : "Meta × 5" : "Meta";
  return <div className={styles.goalMeter} data-compact={compact || undefined} data-configured={configured} title={configured ? `${goal.label} · ${goal.coveredMembers}/${goal.totalMembers} vendedores com meta` : goal.label}>
    <div><span>{configured ? compact ? compactLabel : goal.label : "Sem meta cadastrada"}</span>{configured ? <b>{goalValue(goal.actualValue, metric)} <i>/ {goalValue(goal.targetValue!, metric)}</i></b> : <b>—</b>}</div>
    {configured ? <div className={styles.progressTrack} role="meter" aria-label={`${goal.label}${metric ? ` · ${metric}` : ""}`} aria-valuenow={percent(goal)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent(goal)}%` }} /></div> : <div className={styles.progressTrack}><i /></div>}
    {!compact && configured && goal.coveredMembers < goal.totalMembers ? <small>Cobertura parcial · {goal.coveredMembers}/{goal.totalMembers} vendedores com meta</small> : null}
  </div>;
}

export function DashboardSummary({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  const goal = snapshot.week.goals.sales;
  const contactsToday = snapshot.today.totals.effectiveContacts;
  const contactsWeek = snapshot.week.totals.effectiveContacts;
  const callsToday = snapshot.today.totals.calls;
  const callsWeek = snapshot.week.totals.calls;
  return <div className={styles.summaryStrip}>
    <article aria-label="Contatos de hoje"><span>Contatos de hoje</span><strong>{number.format(contactsToday)}<Icon name="people" /></strong><small>Pessoas únicas contatadas hoje</small></article>
    {front === "ADVERTISING" ? <article aria-label="Tarefas concluídas"><span>Tarefas concluídas hoje</span><strong>{number.format(snapshot.today.totals.tasksCompleted)}<Icon name="check" /></strong><small>{number.format(snapshot.week.totals.tasksCompleted)} na semana · Anúncios</small></article> : <article aria-label="Contatos da semana"><span>Contatos da semana</span><strong>{number.format(contactsWeek)}<Icon name="people" /></strong><small>Pessoas únicas · segunda a sexta</small></article>}
    <article aria-label="Ligações feitas hoje"><span>Ligações feitas hoje</span><strong>{number.format(callsToday)}<Icon name="phone" /></strong><small>{number.format(callsWeek)} na semana · ligações registradas</small></article>
    <article className={styles.summaryGoal}><span>Meta semanal de vendas</span><strong>{goal.targetValue === null ? number.format(snapshot.week.totals.sales) : goalValue(goal.actualValue)}<small>/ {goal.targetValue === null ? "não definida" : goalValue(goal.targetValue)}</small><Icon name="sale" /></strong><small>{goal.targetValue === null ? "Cadastre uma meta semanal em Metas" : goal.label}</small></article>
  </div>;
}

function PeriodPanel({ period, totals, goals, title, dates }: Readonly<{ period: "today" | "week"; totals: RealtimeDashboardTotals; goals: RealtimeDashboardGoals; title: string; dates: string }>) {
  return <section className={styles.periodPanel} data-period={period} aria-label={`Métricas ${period === "today" ? "de hoje" : "da semana"}`}>
    <header><div><span className={styles.eyebrow}>{period === "today" ? "META DIÁRIA" : "ACUMULADO SEMANAL"}</span><h2>{title}</h2></div><span className={styles.periodDate}><Icon name="calendar" />{dates}</span></header>
    <div className={styles.metricGrid}>{metrics.map((metric) => <article className={styles.metricTile} key={metric.key} data-metric={metric.key}>
      <div className={styles.metricLabel}><Icon name={metric.icon} /><span>{metric.label}</span></div><strong className={styles.metricNumber}>{number.format(totals[metric.key])}</strong><p>{metric.detail}</p>
      <GoalMeter goal={goals[metric.key]} metric={metric.key} />
    </article>)}</div>
    <div className={styles.revenueRow}><div><span>Valor vendido</span><strong>{formatCents(totals.salesValueCents)}</strong></div><GoalMeter goal={goals.salesValueCents} metric="salesValueCents" compact /></div>
  </section>;
}

const rateNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const funnelMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const funnelRate = (basisPoints: number | null) => basisPoints === null ? "—" : `${rateNumber.format(basisPoints / 100)}%`;

function SalesFunnel({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  const funnel = snapshot.week.funnel;
  const stages = [
    { key: "leads", label: "Leads trabalhados", value: funnel.leadsWorked, rate: funnel.leadsWorked > 0 ? 10000 : null, basis: "base do funil", icon: "people" },
    { key: "scheduled", label: "Reuniões agendadas", value: funnel.meetingsScheduled, rate: funnel.scheduledRateBasisPoints, basis: "dos leads", icon: "calendar" },
    { key: "completed", label: "Reuniões realizadas", value: funnel.meetingsCompleted, rate: funnel.completedRateBasisPoints, basis: "das agendadas", icon: "check" },
    { key: "sales", label: "Vendas", value: funnel.sales, rate: funnel.salesRateBasisPoints, basis: "das realizadas", icon: "sale" },
  ] as const;
  return <article className={styles.funnelCard} aria-label="Funil de vendas da semana">
    <header><div><span className={styles.eyebrow}>FUNIL COMERCIAL</span><h2>{front === "ADVERTISING" ? "Do anúncio à venda." : "Da prospecção à venda."}</h2></div><Icon name="chart" /></header>
    <div className={styles.funnelPeriod}><span>Esta semana</span><span>{date(snapshot.week.period.fromDate)} — {date(snapshot.week.daily[4]!.date)}</span></div>
    <ol className={styles.funnelStages} aria-label="Etapas do funil comercial">{stages.map(stage => <li key={stage.key} data-funnel-stage={stage.key}>
      <div className={styles.funnelBand}>
        <div className={styles.funnelMetric}><span><Icon name={stage.icon} />{stage.label}</span><strong>{number.format(stage.value)}</strong></div>
        <div className={styles.funnelRate} title={stage.rate === null ? "Sem denominador para calcular a taxa." : `${funnelRate(stage.rate)} ${stage.basis}`}><strong>{funnelRate(stage.rate)}</strong><span>{stage.basis}</span></div>
      </div>
    </li>)}</ol>
    <div className={styles.funnelRevenue}><span>Valor vendido</span><strong>{funnelMoney.format(Number(BigInt(funnel.salesValueCents)) / 100)}</strong><small>Vendas registradas nesta semana</small></div>
    <p className={styles.funnelNote} title="Leads únicos com atividade registrada na semana. As taxas comparam volumes do período, não a evolução de uma mesma coorte. Reuniões realizadas podem ter sido agendadas antes. Um traço indica ausência de denominador.">Volumes da semana · taxas sobre a etapa anterior.</p>
  </article>;
}

export function Overview({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  return <div className={styles.overview}><PeriodPanel period="today" totals={snapshot.today.totals} goals={snapshot.today.goals} title="Hoje" dates={date(snapshot.today.period.fromDate)} /><PeriodPanel period="week" totals={snapshot.week.totals} goals={snapshot.week.goals} title="Esta semana" dates={`${date(snapshot.week.period.fromDate)} — ${date(snapshot.week.period.toDate)}`} /><aside className={styles.overviewAside}><SalesFunnel snapshot={snapshot} front={front} /></aside></div>;
}

function SellerMetric({ row, metric }: Readonly<{ row: RealtimeDashboardRankingRow; metric: typeof metrics[number] }>) {
  return <div role="cell" className={styles.sellerMetric}><div><span>Hoje</span><b>{number.format(row.today[metric.key])}</b></div><GoalMeter goal={row.goals.today[metric.key]} metric={metric.key} compact /><div><span>Semana</span><strong>{number.format(row[metric.key])}</strong></div><GoalMeter goal={row.goals.week[metric.key]} metric={metric.key} compact /></div>;
}

export function Leaderboard({ snapshot, page, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; page: number; front: RealtimeDashboardFront }>) {
  const rows = snapshot.week.ranking;
  const pages = Math.max(1, Math.ceil(rows.length / 4));
  const currentPage = page % pages;
  return <div className={styles.rankingView}><div className={styles.leaderGrid}>{rows.slice(0, 3).map((row) => {
    const goals = Object.values(row.goals.today).filter((goal) => goal.targetValue !== null && BigInt(goal.targetValue) > 0n);
    return <article className={styles.leaderCard} key={row.position} data-position={row.position}><span className={styles.podiumPosition}>0{row.position}</span><Avatar initials={row.initials} position={row.position} /><div className={styles.leaderName}><h3>{row.name}</h3><span>{number.format(row.meetingsScheduled)} agendamentos na semana</span></div><div className={styles.leaderResult}><strong>{number.format(row.today.meetingsScheduled)}</strong><span>reuniões agendadas hoje</span></div><div className={styles.leaderGoals}><Icon name="check" /><span>{goals.length ? `${goals.filter((goal) => (goal.progressBasisPoints ?? 0) >= 10_000).length}/${goals.length} metas diárias atingidas` : "Metas diárias não configuradas"}</span></div></article>;
  })}</div><section className={styles.rankingPanel} aria-label="Ranking de atividade"><header><div><span className={styles.eyebrow}>RESULTADO INDIVIDUAL</span><h2>Ranking de atividade</h2></div><div><span>{rows.length} profissionais</span><span>Página {currentPage + 1}/{pages}</span></div></header>
    <div className={styles.rankingTable} role="table" aria-label="Ranking semanal da equipe"><div className={styles.rankingHeader} role="row"><span role="columnheader">#</span><span role="columnheader">Profissional</span>{metrics.map((metric) => <span role="columnheader" key={metric.key}>{metric.label}</span>)}</div>
      {rows.slice(currentPage * 4, currentPage * 4 + 4).map((row) => <div className={styles.rankingRow} role="row" key={row.position}><b role="cell" className={styles.rankNumber}>{row.position}</b><div role="cell" className={styles.tablePerson}><Avatar initials={row.initials} position={row.position} /><div><strong>{row.name}</strong><span>{number.format(row.meetingsScheduled)} agendamentos na semana</span><small>{front === "ADVERTISING" ? `${number.format(row.today.tasksCompleted)} tarefas hoje · ${number.format(row.tasksCompleted)} na semana · ` : ""}{formatCents(row.salesValueCents)} vendidos</small></div></div>{metrics.map((metric) => <SellerMetric key={metric.key} row={row} metric={metric} />)}</div>)}
      {rows.length === 0 ? <div className={styles.noRanking}>Nenhum profissional comercial neste período.</div> : null}
    </div><footer><span>Ordem: agendamentos de hoje · desempate: semana e nome.</span><span>Metas sem configuração aparecem como “—”.</span></footer></section></div>;
}
