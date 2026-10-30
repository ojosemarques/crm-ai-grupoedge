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
  const automatic = goal.source === "ADVERTISING_ARRIVALS" || goal.source === "ADVERTISING_BOOKINGS";
  const configured = goal.targetValue !== null && (BigInt(goal.targetValue) > 0n || automatic);
  const emptyLabel = goal.label === "Não se aplica à função" ? compact ? "Não se aplica" : goal.label : "Sem meta cadastrada";
  const compactLabel = automatic ? goal.source === "ADVERTISING_BOOKINGS" ? "Meta 60%" : metric === "meetingsScheduled" ? "Meta 50%" : "Leads recebidos" : metric === "messages" ? goal.label.includes("WA/IG") ? "Meta WA/IG" : "Meta mensagens" : goal.source === "DAILY_PROFILE_X5" ? metric === "effectiveContacts" ? "Contatos-dia" : "Meta × 5" : "Meta";
  return <div className={styles.goalMeter} data-compact={compact || undefined} data-configured={configured} title={configured ? `${goal.label} · ${goal.coveredMembers}/${goal.totalMembers} vendedores com meta` : goal.label}>
    <div><span>{configured ? compact ? compactLabel : goal.label : emptyLabel}</span>{configured ? <b>{goalValue(goal.actualValue, metric)} <i>/ {goalValue(goal.targetValue!, metric)}</i></b> : <b>—</b>}</div>
    {configured ? <div className={styles.progressTrack} role="meter" aria-label={`${goal.label}${metric ? ` · ${metric}` : ""}`} aria-valuenow={percent(goal)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent(goal)}%` }} /></div> : <div className={styles.progressTrack}><i /></div>}
    {!compact && configured && goal.coveredMembers < goal.totalMembers ? <small>Cobertura parcial · {goal.coveredMembers}/{goal.totalMembers} vendedores com meta</small> : null}
  </div>;
}

export function DashboardSummary({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  const filtered = Boolean(snapshot.selection);
  const label = snapshot.selection?.label ?? "Hoje";
  const goal = snapshot.week.goals.sales;
  const contactsToday = snapshot.today.totals.effectiveContacts;
  const contactsWeek = snapshot.week.totals.effectiveContacts;
  const callsToday = snapshot.today.totals.calls;
  const callsWeek = snapshot.week.totals.calls;
  return <div className={styles.summaryStrip}>
    <article aria-label={front === "ADVERTISING" ? filtered ? "Leads no período" : "Leads hoje" : filtered ? "Contatos no período" : "Contatos de hoje"}><span>{front === "ADVERTISING" ? filtered ? "Leads no período" : "Leads hoje" : filtered ? "Contatos no período" : "Contatos de hoje"}</span><strong>{number.format(front === "ADVERTISING" ? snapshot.today.leadsReceived ?? 0 : contactsToday)}<Icon name={front === "ADVERTISING" ? "target" : "people"} /></strong><small>{front === "ADVERTISING" ? filtered ? "Leads únicos recebidos no período" : "Leads únicos recebidos de anúncios hoje" : filtered ? "Pessoas únicas contatadas no período" : "Pessoas únicas contatadas hoje"}</small></article>
    {front === "ADVERTISING" || filtered ? <article aria-label="Reuniões agendadas"><span>Reuniões agendadas</span><strong>{number.format(snapshot.today.totals.meetingsScheduled)}<Icon name="calendar" /></strong><small>{filtered ? label : `${number.format(snapshot.week.totals.meetingsScheduled)} na semana · Anúncios`}</small></article> : <article aria-label={filtered ? "Contatos no período" : "Contatos da semana"}><span>{filtered ? "Contatos no período" : "Contatos da semana"}</span><strong>{number.format(contactsWeek)}<Icon name="people" /></strong><small>Pessoas únicas{filtered ? " no período" : " · segunda a sexta"}</small></article>}
    {front === "ADVERTISING" ? <article aria-label="Reuniões feitas"><span>Reuniões feitas</span><strong>{number.format(snapshot.today.totals.meetingsCompleted)}<Icon name="check" /></strong><small>{filtered ? label : `${number.format(snapshot.week.totals.meetingsCompleted)} na semana · Anúncios`}</small></article> : <article aria-label={filtered ? "Ligações no período" : "Ligações feitas hoje"}><span>{filtered ? "Ligações no período" : "Ligações feitas hoje"}</span><strong>{number.format(callsToday)}<Icon name="phone" /></strong><small>{filtered ? label : `${number.format(callsWeek)} na semana · ligações registradas`}</small></article>}
    <article className={styles.summaryGoal}><span>{filtered ? "Vendas no período" : "Meta semanal de vendas"}</span><strong>{goal.targetValue === null ? number.format(snapshot.week.totals.sales) : goalValue(goal.actualValue)}{!filtered ? <small>/ {goal.targetValue === null ? "não definida" : goalValue(goal.targetValue)}</small> : null}<Icon name="sale" /></strong><small>{filtered ? formatCents(snapshot.week.totals.salesValueCents) : goal.targetValue === null ? "Cadastre uma meta semanal em Metas" : goal.label}</small></article>
  </div>;
}

function PeriodPanel({ period, totals, goals, title, dates, front, filtered = false }: Readonly<{ filtered?: boolean; front: RealtimeDashboardFront; period: "today" | "week"; totals: RealtimeDashboardTotals; goals: RealtimeDashboardGoals; title: string; dates: string }>) {
  return <section className={styles.periodPanel} data-period={period} aria-label={filtered ? `Métricas ${title}` : `Métricas ${period === "today" ? "de hoje" : "da semana"}`}>
    <header><div><span className={styles.eyebrow}>{filtered ? "PERÍODO SELECIONADO" : period === "today" ? "META DIÁRIA" : "ACUMULADO SEMANAL"}</span><h2>{title}</h2></div><span className={styles.periodDate}><Icon name="calendar" />{dates}</span></header>
    <div className={styles.metricGrid}>{metrics.map((metric) => <article className={styles.metricTile} key={metric.key} data-metric={metric.key}>
      <div className={styles.metricLabel}><Icon name={metric.icon} /><span>{metric.label}</span></div><strong className={styles.metricNumber}>{number.format(totals[metric.key])}</strong><p>{filtered ? metric.detail : front === "ADVERTISING" ? metric.key === "effectiveContacts" ? `Leads recebidos ${period === "today" ? "hoje" : "na semana"} contatados` : metric.key === "calls" ? `Ligações aos leads ${period === "today" ? "de hoje" : "da semana"}` : metric.key === "messages" ? "Atividades de mensagem enviada" : metric.detail : metric.detail}</p>
      {!filtered ? <GoalMeter goal={goals[metric.key]} metric={metric.key} /> : null}
    </article>)}</div>
    <div className={styles.revenueRow}><div><span>Valor vendido</span><strong>{formatCents(totals.salesValueCents)}</strong></div>{!filtered ? <GoalMeter goal={goals.salesValueCents} metric="salesValueCents" compact /> : null}</div>
  </section>;
}

const rateNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const funnelMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const funnelRate = (basisPoints: number | null) => basisPoints === null ? "—" : `${rateNumber.format(basisPoints / 100)}%`;

function SalesFunnel({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  const filtered = Boolean(snapshot.selection);
  const funnel = snapshot.week.funnel;
  const stages = [
    { key: "leads", label: front === "ADVERTISING" ? "Leads Anúncios" : "Leads trabalhados", value: front === "ADVERTISING" ? snapshot.week.leadsReceived ?? 0 : funnel.leadsWorked, rate: (front === "ADVERTISING" ? snapshot.week.leadsReceived ?? 0 : funnel.leadsWorked) > 0 ? 10000 : null, basis: "base do funil", icon: "people" },
    { key: "scheduled", label: "Reuniões agendadas", value: funnel.meetingsScheduled, rate: funnel.scheduledRateBasisPoints, basis: "dos leads", icon: "calendar" },
    { key: "completed", label: "Reuniões realizadas", value: funnel.meetingsCompleted, rate: funnel.completedRateBasisPoints, basis: "das agendadas", icon: "check" },
    { key: "sales", label: "Vendas", value: funnel.sales, rate: funnel.salesRateBasisPoints, basis: "das realizadas", icon: "sale" },
  ] as const;
  return <article className={styles.funnelCard} aria-label={filtered ? "Funil de vendas do período" : "Funil de vendas da semana"}>
    <header><div><span className={styles.eyebrow}>FUNIL COMERCIAL</span><h2>{front === "ADVERTISING" ? "Do anúncio à venda." : "Da prospecção à venda."}</h2></div><Icon name="chart" /></header>
    <div className={styles.funnelPeriod}><span>{snapshot.selection?.label ?? "Esta semana"}</span><span>{date(snapshot.week.period.fromDate)} — {date(filtered ? snapshot.week.period.toDate : snapshot.week.daily[4]!.date)}</span></div>
    <ol className={styles.funnelStages} aria-label="Etapas do funil comercial">{stages.map(stage => <li key={stage.key} data-funnel-stage={stage.key}>
      <div className={styles.funnelBand}>
        <div className={styles.funnelMetric}><span><Icon name={stage.icon} />{stage.label}</span><strong>{number.format(stage.value)}</strong></div>
        <div className={styles.funnelRate} title={stage.rate === null ? "Sem denominador para calcular a taxa." : `${funnelRate(stage.rate)} ${stage.basis}`}><strong>{funnelRate(stage.rate)}</strong><span>{stage.basis}</span></div>
      </div>
    </li>)}</ol>
    <div className={styles.funnelRevenue}><span>Valor vendido</span><strong>{funnelMoney.format(Number(BigInt(funnel.salesValueCents)) / 100)}</strong><small>{filtered ? "Vendas registradas no período" : "Vendas registradas nesta semana"}</small></div>
    <p className={styles.funnelNote} title={`${front === "ADVERTISING" ? "Leads únicos recebidos de anúncios no período, inclusive sem atividade." : "Leads únicos com atividade registrada no período."} As taxas comparam volumes do período, não a evolução de uma mesma coorte. Reuniões realizadas podem ter sido agendadas antes. Um traço indica ausência de denominador.`}>{filtered ? "Volumes do período" : "Volumes da semana"} · taxas sobre a etapa anterior.</p>
  </article>;
}

export function Overview({ snapshot, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; front: RealtimeDashboardFront }>) {
  const filtered = Boolean(snapshot.selection);
  return <div className={styles.overview} data-filtered={filtered || undefined}><PeriodPanel filtered={filtered} front={front} period="today" totals={snapshot.today.totals} goals={snapshot.today.goals} title={snapshot.selection?.label ?? "Hoje"} dates={filtered ? `${snapshot.today.period.fromDate.split("-").reverse().join("/")} — ${snapshot.today.period.toDate.split("-").reverse().join("/")}` : date(snapshot.today.period.fromDate)} />{!filtered ? <PeriodPanel front={front} period="week" totals={snapshot.week.totals} goals={snapshot.week.goals} title="Esta semana" dates={`${date(snapshot.week.period.fromDate)} — ${date(snapshot.week.period.toDate)}`} /> : null}<aside className={styles.overviewAside}><SalesFunnel snapshot={snapshot} front={front} /></aside></div>;
}

function SellerMetric({ row, metric, filtered }: Readonly<{ filtered: boolean; row: RealtimeDashboardRankingRow; metric: typeof metrics[number] }>) {
  if (filtered) return <div role="cell" className={styles.sellerMetric}><div><span>Período</span><b>{number.format(row.today[metric.key])}</b></div></div>;
  return <div role="cell" className={styles.sellerMetric}><div><span>Hoje</span><b>{number.format(row.today[metric.key])}</b></div><GoalMeter goal={row.goals.today[metric.key]} metric={metric.key} compact /><div><span>Semana</span><strong>{number.format(row[metric.key])}</strong></div><GoalMeter goal={row.goals.week[metric.key]} metric={metric.key} compact /></div>;
}

export function Leaderboard({ snapshot, page, front }: Readonly<{ snapshot: RealtimeDashboardSnapshot; page: number; front: RealtimeDashboardFront }>) {
  const filtered = Boolean(snapshot.selection);
  const rows = snapshot.week.ranking;
  const pages = Math.max(1, Math.ceil(rows.length / 4));
  const currentPage = page % pages;
  return <div className={styles.rankingView}><div className={styles.leaderGrid}>{rows.slice(0, 3).map((row) => {
    const closer = front === "ADVERTISING" && row.advertisingRole === "CLOSER";
    const goals = Object.values(row.goals.today).filter((goal) => goal.targetValue !== null && BigInt(goal.targetValue) > 0n);
    return <article className={styles.leaderCard} key={row.position} data-position={row.position}><span className={styles.podiumPosition}>0{row.position}</span><Avatar initials={row.initials} position={row.position} /><div className={styles.leaderName}><h3>{row.name}</h3><span>{number.format(closer ? row.meetingsCompleted : row.meetingsScheduled)} {closer ? "reuniões feitas" : "agendamentos"} {filtered ? "no período" : "na semana"}</span></div><div className={styles.leaderResult}><strong>{number.format(closer ? row.today.meetingsCompleted : row.today.meetingsScheduled)}</strong><span>{closer ? filtered ? "reuniões feitas no período" : "reuniões feitas hoje" : filtered ? "pessoas agendadas no período" : "reuniões agendadas hoje"}</span></div>{!filtered ? <div className={styles.leaderGoals}><Icon name="check" /><span>{goals.length ? `${goals.filter((goal) => (goal.progressBasisPoints ?? 0) >= 10_000).length}/${goals.length} metas diárias atingidas` : "Metas diárias não configuradas"}</span></div> : null}</article>;
  })}</div><section className={styles.rankingPanel} aria-label="Ranking de atividade"><header><div><span className={styles.eyebrow}>RESULTADO INDIVIDUAL</span><h2>Ranking de atividade</h2></div><div><span>{rows.length} profissionais</span><span>Página {currentPage + 1}/{pages}</span></div></header>
    <div className={styles.rankingTable} role="table" aria-label={filtered ? "Ranking da equipe no período" : "Ranking semanal da equipe"} style={front === "ADVERTISING" ? { gridTemplateRows: `1.6em repeat(${Math.max(1, Math.min(4, rows.length))}, minmax(0, 1fr))` } : undefined}><div className={styles.rankingHeader} role="row"><span role="columnheader">#</span><span role="columnheader">Profissional</span>{metrics.map((metric) => <span role="columnheader" key={metric.key}>{metric.label}</span>)}</div>
      {rows.slice(currentPage * 4, currentPage * 4 + 4).map((row) => <div className={styles.rankingRow} role="row" key={row.position}><b role="cell" className={styles.rankNumber}>{row.position}</b><div role="cell" className={styles.tablePerson}><Avatar initials={row.initials} position={row.position} /><div><strong>{row.name}</strong><span>{number.format(row.meetingsScheduled)} agendamentos {filtered ? "no período" : "na semana"}</span><small>{front === "ADVERTISING" ? filtered ? `${number.format(row.today.tasksCompleted)} tarefas no período · ` : `${number.format(row.today.tasksCompleted)} tarefas hoje · ${number.format(row.tasksCompleted)} na semana · ` : ""}{formatCents(row.salesValueCents)} vendidos</small></div></div>{metrics.map((metric) => <SellerMetric key={metric.key} row={row} metric={metric} filtered={filtered} />)}</div>)}
      {rows.length === 0 ? <div className={styles.noRanking}>Nenhum profissional comercial neste período.</div> : null}
    </div><footer><span>{filtered ? "Ordem: resultados da função no período selecionado." : front === "ADVERTISING" ? "Ordem: atingimento da meta da função hoje · desempate: resultado e semana." : "Ordem: agendamentos de hoje · desempate: semana e nome."}</span><span>{filtered ? "Metas atuais disponíveis na visão Hoje." : "Metas sem configuração aparecem como “—”."}</span></footer></section></div>;
}
