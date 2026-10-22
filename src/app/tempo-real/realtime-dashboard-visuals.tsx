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
  { key: "messages", label: "Mensagens enviadas", detail: "WhatsApp, Instagram e e-mail", icon: "message" },
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

export function DashboardSummary({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const goal = snapshot.week.goals.sales;
  const contactsToday = snapshot.today.totals.effectiveContacts;
  const contactsWeek = snapshot.week.totals.effectiveContacts;
  const callsToday = snapshot.today.totals.calls;
  const callsWeek = snapshot.week.totals.calls;
  return <div className={styles.summaryStrip}>
    <article aria-label="Contatos de hoje"><span>Contatos de hoje</span><strong>{number.format(contactsToday)}<Icon name="people" /></strong><small>Pessoas únicas contatadas hoje</small></article>
    <article aria-label="Contatos da semana"><span>Contatos da semana</span><strong>{number.format(contactsWeek)}<Icon name="people" /></strong><small>Pessoas únicas · segunda a sexta</small></article>
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

function SalesGoal({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const goal = snapshot.week.goals.sales;
  const configured = goal.targetValue !== null && BigInt(goal.targetValue) > 0n;
  return <article className={styles.salesGoalCard} aria-label="Meta de vendas da semana"><header><span className={styles.eyebrow}>FOCO DA SEMANA</span><Icon name="sale" /></header><h2>Transformar atividade<br />em resultado.</h2><div className={styles.salesGoalVisual}><div className={styles.goalRing}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="51" /><circle cx="60" cy="60" r="51" pathLength="100" strokeDasharray={`${percent(goal)} 100`} /></svg><strong>{configured ? `${Math.round((goal.progressBasisPoints ?? 0) / 100)}%` : "—"}</strong></div><div><strong>{configured ? goalValue(goal.actualValue) : snapshot.week.totals.sales}</strong><span>{configured ? `de ${goalValue(goal.targetValue!)} vendas` : "vendas na semana"}</span></div></div><GoalMeter goal={goal} metric="sales" /><p>Semana comercial · {date(snapshot.week.period.fromDate)} a {date(snapshot.week.daily[4]!.date)}</p></article>;
}

function WeeklyChart({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const days = snapshot.week.daily;
  const top = Math.ceil(Math.max(4, ...days.flatMap((day) => [day.totals.calls, day.totals.messages])) / 4) * 4;
  const points = (kind: "calls" | "messages") => days.flatMap((day, index) => day.future ? [] : [`${38 + index * 65},${180 - day.totals[kind] / top * 150}`]);
  return <article className={styles.chartCard} aria-label="Evolução semanal"><header><div><span className={styles.eyebrow}>CONSISTÊNCIA</span><h3>Evolução da equipe</h3></div><Icon name="chart" /></header><div className={styles.chartLegend}><span><i />Ligações</span><span><i />Mensagens</span></div><svg viewBox="0 0 325 215" role="img" aria-label="Ligações e mensagens por dia útil da semana">
    {[0, 1, 2, 3, 4].map((step) => <g key={step}><line x1="38" x2="298" y1={180 - step * 37.5} y2={180 - step * 37.5} /><text x="27" y={184 - step * 37.5} textAnchor="end">{number.format(top / 4 * step)}</text></g>)}
    {days.map((day, index) => <text key={day.date} x={38 + index * 65} y="207" textAnchor="middle">{["SEG", "TER", "QUA", "QUI", "SEX"][index]}</text>)}
    {(["calls", "messages"] as const).map((kind) => <g key={kind} className={styles.chartSeries} data-series={kind}><polyline points={points(kind).join(" ")} />{points(kind).map((point, index) => <circle key={index} cx={point.split(",")[0]} cy={point.split(",")[1]} r="3" />)}</g>)}
  </svg><p>Fatos registrados · {snapshot.timeZone}</p></article>;
}

export function Overview({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  return <div className={styles.overview}><PeriodPanel period="today" totals={snapshot.today.totals} goals={snapshot.today.goals} title="Hoje" dates={date(snapshot.today.period.fromDate)} /><PeriodPanel period="week" totals={snapshot.week.totals} goals={snapshot.week.goals} title="Esta semana" dates={`${date(snapshot.week.period.fromDate)} — ${date(snapshot.week.period.toDate)}`} /><aside className={styles.overviewAside}><SalesGoal snapshot={snapshot} /><WeeklyChart snapshot={snapshot} /></aside></div>;
}

function SellerMetric({ row, metric }: Readonly<{ row: RealtimeDashboardRankingRow; metric: typeof metrics[number] }>) {
  return <div role="cell" className={styles.sellerMetric}><div><span>Hoje</span><b>{number.format(row.today[metric.key])}</b></div><GoalMeter goal={row.goals.today[metric.key]} metric={metric.key} compact /><div><span>Semana</span><strong>{number.format(row[metric.key])}</strong></div><GoalMeter goal={row.goals.week[metric.key]} metric={metric.key} compact /></div>;
}

export function Leaderboard({ snapshot, page }: Readonly<{ snapshot: RealtimeDashboardSnapshot; page: number }>) {
  const rows = snapshot.week.ranking;
  const pages = Math.max(1, Math.ceil(rows.length / 4));
  const currentPage = page % pages;
  return <div className={styles.rankingView}><div className={styles.leaderGrid}>{rows.slice(0, 3).map((row) => {
    const goals = Object.values(row.goals.today).filter((goal) => goal.targetValue !== null && BigInt(goal.targetValue) > 0n);
    return <article className={styles.leaderCard} key={row.position} data-position={row.position}><span className={styles.podiumPosition}>0{row.position}</span><Avatar initials={row.initials} position={row.position} /><div className={styles.leaderName}><h3>{row.name}</h3><span>{number.format(row.meetingsScheduled)} agendamentos na semana</span></div><div className={styles.leaderResult}><strong>{number.format(row.today.meetingsScheduled)}</strong><span>reuniões agendadas hoje</span></div><div className={styles.leaderGoals}><Icon name="check" /><span>{goals.length ? `${goals.filter((goal) => (goal.progressBasisPoints ?? 0) >= 10_000).length}/${goals.length} metas diárias atingidas` : "Metas diárias não configuradas"}</span></div></article>;
  })}</div><section className={styles.rankingPanel} aria-label="Ranking de atividade"><header><div><span className={styles.eyebrow}>RESULTADO INDIVIDUAL</span><h2>Ranking de atividade</h2></div><div><span>{rows.length} profissionais</span><span>Página {currentPage + 1}/{pages}</span></div></header>
    <div className={styles.rankingTable} role="table" aria-label="Ranking semanal da equipe"><div className={styles.rankingHeader} role="row"><span role="columnheader">#</span><span role="columnheader">Profissional</span>{metrics.map((metric) => <span role="columnheader" key={metric.key}>{metric.label}</span>)}</div>
      {rows.slice(currentPage * 4, currentPage * 4 + 4).map((row) => <div className={styles.rankingRow} role="row" key={row.position}><b role="cell" className={styles.rankNumber}>{row.position}</b><div role="cell" className={styles.tablePerson}><Avatar initials={row.initials} position={row.position} /><div><strong>{row.name}</strong><span>{number.format(row.meetingsScheduled)} agendamentos na semana</span><small>{formatCents(row.salesValueCents)} vendidos</small></div></div>{metrics.map((metric) => <SellerMetric key={metric.key} row={row} metric={metric} />)}</div>)}
      {rows.length === 0 ? <div className={styles.noRanking}>Nenhum profissional comercial neste período.</div> : null}
    </div><footer><span>Ordem: agendamentos de hoje · desempate: semana e nome.</span><span>Metas sem configuração aparecem como “—”.</span></footer></section></div>;
}
