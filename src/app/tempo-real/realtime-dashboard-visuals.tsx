import type { CSSProperties, ReactNode } from "react";

import type {
  RealtimeDashboardRankingRow,
  RealtimeDashboardSnapshot,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import styles from "./realtime-dashboard.module.css";

export const number = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export function formatCents(value: string) { return money.format(Number(BigInt(value)) / 100); }

type IconName = "grid" | "trophy" | "chart" | "expand" | "exit" | "play" | "pause" | "link" | "close" | "copy" | "phone" | "message" | "people" | "calendar" | "check" | "sale" | "arrow" | "clock";
const iconPaths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  trophy: <><path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v5m-4 3h8m-6-3h4v3" /></>,
  chart: <><path d="M4 3v17h17M8 15l4-5 4 3 5-8" /></>,
  expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  exit: <path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h13" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: <><path d="M8 4v16M16 4v16" /></>,
  link: <><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  phone: <path d="m5 3 4 4-2 3a17 17 0 0 0 7 7l3-2 4 4-2 2C11 23 1 13 3 5l2-2Z" />,
  message: <path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z" />,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 6-7" /></>,
  sale: <><path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
};

export function Icon({ name, className }: Readonly<{ name: IconName; className?: string }>) {
  return <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">{iconPaths[name]}</svg>;
}

export function BrandMark() {
  return <svg aria-hidden="true" className={styles.brandMark} fill="currentColor" viewBox="0 0 40 40"><path d="M4 33 20 3a1.5 1.5 0 0 1 2.6 1.5L7 34.5A1.7 1.7 0 0 1 4 33Zm7 0L25 7a1.5 1.5 0 0 1 2.6 1.5l-13.6 26A1.7 1.7 0 0 1 11 33Zm7 0L29 13a1.5 1.5 0 0 1 2.6 1.5l-10.6 20A1.7 1.7 0 0 1 18 33Zm8-2 7-12 7 14a1 1 0 0 1-1 1H28a2 2 0 0 1-2-3Z" /></svg>;
}

export function Avatar({ initials, position = 1 }: Readonly<{ initials: string; position?: number }>) {
  return <span className={styles.avatar} data-color={((position - 1) % 5) + 1}>{initials}</span>;
}

function GoldMedal() {
  return <svg className={styles.medal} aria-label="Primeiro lugar" role="img" viewBox="0 0 100 150">
    <defs><linearGradient id="tv-gold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff399" /><stop offset=".45" stopColor="#f7d653" /><stop offset="1" stopColor="#d39a1e" /></linearGradient></defs>
    <path d="M16 0h20l20 58-13 11Z" fill="#d6474b" /><path d="M23 0h8l20 58-5 3Z" fill="#fff" /><path d="M62 0h21L57 69l-15-8Z" fill="#4b74bc" /><path d="M69 0h7L52 65l-5-3Z" fill="#fff" /><path d="M42 57h16v14H42Z" fill="#e8c546" />
    <circle cx="50" cy="103" r="42" fill="url(#tv-gold)" stroke="#f5df79" strokeWidth="3" /><circle cx="50" cy="103" r="35" fill="none" stroke="#fff3a0" strokeWidth="1.5" strokeDasharray="1 2" /><circle cx="50" cy="103" r="30" fill="none" stroke="#e1b52e" />
    <path d="m23 102 4 5-1 7 6 2 3 7 7-1m35-20-4 5 1 7-6 2-3 7-7-1" fill="none" stroke="#fff095" strokeWidth="2" />
    <text x="50" y="117" fill="#fff4ae" fontFamily="Arial, sans-serif" fontSize="44" fontWeight="700" textAnchor="middle">1</text>
  </svg>;
}

function Countdown({ endsAt, now }: Readonly<{ endsAt: string; now: number }>) {
  const remaining = Math.max(0, Date.parse(endsAt) - now);
  const values = [Math.floor(remaining / 86_400_000), Math.floor(remaining / 3_600_000) % 24, Math.floor(remaining / 60_000) % 60];
  return <div className={styles.countdown} aria-label={`Encerramento em ${values[0]} dias, ${values[1]} horas e ${values[2]} minutos`}>
    {values.map((value, index) => <div key={index}><strong>{String(value).padStart(2, "0")}</strong><span>{["DIAS", "HORAS", "MINUTOS"][index]}</span></div>)}
  </div>;
}

function LeaderCard({ row }: Readonly<{ row: RealtimeDashboardRankingRow }>) {
  return <article className={styles.leaderCard} data-position={row.position}>
    {row.position === 1 ? <GoldMedal /> : null}
    <div className={styles.leaderIdentity}><div className={styles.rankedAvatar}><Avatar initials={row.initials} position={row.position} /><b>{row.position}</b></div><div><h3>{row.name}</h3><span>{row.position === 1 ? "Líder da semana" : `${row.position}º no ranking`}</span></div></div>
    <dl className={styles.leaderMetrics}><div><dt>CONTATOS</dt><dd>{number.format(row.effectiveContacts)}</dd></div><div><dt>REUNIÕES</dt><dd>{number.format(row.meetingsCompleted)}</dd></div><div><dt>AÇÕES</dt><dd>{number.format(row.actions)}</dd></div></dl>
    <div className={styles.leaderBadges}><span><Icon name="sale" />{number.format(row.sales)} vendas</span><span><i>◆</i>{formatCents(row.salesValueCents)}</span></div>
  </article>;
}

export function Leaderboard({ snapshot, now, page }: Readonly<{ snapshot: RealtimeDashboardSnapshot; now: number; page: number }>) {
  const rows = snapshot.week.ranking;
  const pageSize = 4;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = page % pages;
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <div className={styles.darkDashboard}>
    <div className={styles.darkHeading}><h1>Leaderboard</h1><span>DESEMPENHO DA SEMANA</span></div>
    <div className={styles.summaryGrid}>
      <article className={styles.summaryCard}><div><strong>{number.format(snapshot.week.totals.calls + snapshot.week.totals.messages + snapshot.week.totals.meetingsScheduled + snapshot.week.totals.meetingsCompleted)}</strong><span className={styles.summaryIcon} data-tone="green"><Icon name="check" /></span></div><p>Total de ações</p></article>
      <article className={styles.summaryCard}><div><strong>{number.format(snapshot.week.totals.effectiveContacts)}</strong><span className={styles.summaryIcon} data-tone="blue"><Icon name="people" /></span></div><p>Contatos efetivos</p></article>
      <article className={styles.countdownCard}><div><h2>Tempo para encerrar<br />a semana <span aria-hidden="true">🔥</span></h2><Countdown endsAt={snapshot.week.endsAt} now={now} /></div><p>O ranking considera a atividade comercial de segunda a sexta</p></article>
    </div>
    <div className={styles.leaderGrid}>{rows.slice(0, 3).map((row) => <LeaderCard key={row.position} row={row} />)}{rows.length === 0 ? <div className={styles.noRanking}>O pódio será preenchido com a atividade da equipe.</div> : null}</div>
    <section className={styles.rankingPanel} aria-labelledby="ranking-heading">
      <div className={styles.rankingTitle}><h2 id="ranking-heading">Ranking de atividade</h2><span>{number.format(rows.length)} profissionais <b>·</b> {currentPage + 1}/{pages}</span></div>
      <div className={styles.rankingTable} role="table" aria-label="Ranking semanal da equipe">
        <div className={styles.rankingHeader} role="row"><span role="columnheader">Posição</span><span role="columnheader">Profissional</span><span role="columnheader">Ligações</span><span role="columnheader">Mensagens</span><span role="columnheader">Contatos</span><span role="columnheader">Reuniões</span><span role="columnheader">Vendas</span><span role="columnheader">Ações</span></div>
        {visibleRows.map((row) => <div className={styles.rankingRow} role="row" key={row.position}>
          <span role="cell"><b className={styles.rankNumber}>{row.position}</b></span>
          <span className={styles.tablePerson} role="cell"><Avatar initials={row.initials} position={row.position} /><span><strong>{row.name}</strong><small>{row.position <= 3 ? "Top 3 da semana" : "Equipe comercial"}</small></span></span>
          <span role="cell">{number.format(row.calls)}</span><span role="cell">{number.format(row.messages)}</span><span role="cell">{number.format(row.effectiveContacts)}</span><span role="cell">{number.format(row.meetingsCompleted)}<small>{number.format(row.meetingsScheduled)} marcadas</small></span><span role="cell">{number.format(row.sales)}<small>{formatCents(row.salesValueCents)}</small></span><strong role="cell">{number.format(row.actions)}</strong>
        </div>)}
        {rows.length === 0 ? <p className={styles.noRanking}>Nenhuma atividade comercial nesta semana.</p> : null}
      </div>
    </section>
  </div>;
}

function ActivityFlow({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const totals = snapshot.today.totals;
  const stages = [{ label: "Ligações", value: totals.calls }, { label: "Mensagens", value: totals.messages }, { label: "Contatos", value: totals.effectiveContacts }, { label: "Agendadas", value: totals.meetingsScheduled }, { label: "Realizadas", value: totals.meetingsCompleted }, { label: "Vendas", value: totals.sales }];
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  const heights = stages.map((stage) => 10 + (stage.value / max) * 80);
  return <section className={styles.flowPanel} aria-label="Fluxo de atividade de hoje">
    <div className={styles.flowLabels}>{stages.map((stage) => <div key={stage.label}><span>{stage.label}</span><strong>{number.format(stage.value)}</strong></div>)}</div>
    <div className={styles.flowGraph}>
      <svg aria-hidden="true" viewBox="0 0 600 140" preserveAspectRatio="none">{heights.map((height, index) => {
        const next = heights[index + 1] ?? height;
        const x = index * 100;
        return <path key={index} fill={["#edf4ff", "#deebff", "#c5ddff", "#a4cbff", "#7bb4fb", "#3b82f6"][index]} d={`M${x} ${70 - height / 2} C${x + 50} ${70 - height / 2} ${x + 50} ${70 - next / 2} ${x + 100} ${70 - next / 2} V${70 + next / 2} C${x + 50} ${70 + next / 2} ${x + 50} ${70 + height / 2} ${x} ${70 + height / 2}Z`} />;
      })}</svg>
      <div className={styles.flowArrows}>{stages.slice(0, 5).map((stage) => <span key={stage.label}><Icon name="arrow" /></span>)}</div>
    </div><p>Volumes registrados em cada etapa · hoje</p>
  </section>;
}

function ActivityDonut({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const totals = snapshot.today.totals;
  const segments = [{ label: "Ligações", value: totals.calls, color: "#3d82ee" }, { label: "Mensagens", value: totals.messages, color: "#7064ed" }, { label: "Agendadas", value: totals.meetingsScheduled, color: "#19b48c" }, { label: "Realizadas", value: totals.meetingsCompleted, color: "#f4cc59" }, { label: "Vendas", value: totals.sales, color: "#858585" }];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return <article className={styles.donutCard}><div className={styles.lightCardHeader}><span>Distribuição de atividade</span><Icon name="chart" /></div>
    <div className={styles.donutVisual}><svg viewBox="0 0 240 240" aria-hidden="true"><circle cx="120" cy="120" r="94" fill="none" stroke="#f0f2f5" strokeWidth="21" />{segments.map((segment) => {
      if (!segment.value || !total) return null;
      const length = total ? segment.value / total * 100 : 0;
      const start = offset;
      offset += length;
      return <g key={segment.label}><circle cx="120" cy="120" r="94" fill="none" stroke={segment.color} opacity=".18" strokeWidth="21" pathLength="100" strokeDasharray={`${Math.max(0, length - 1.5)} ${100 - Math.max(0, length - 1.5)}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" /><circle cx="120" cy="120" r="106" fill="none" stroke={segment.color} strokeWidth="4" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.max(0, length - 1.5)} ${100 - Math.max(0, length - 1.5)}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" /></g>;
    })}</svg><div><span>Total de eventos</span><strong>{number.format(total)}</strong><small>hoje</small></div></div>
    <div className={styles.donutLegend}>{segments.map((segment) => <span key={segment.label}><i style={{ background: segment.color }} />{segment.label}<b>{number.format(segment.value)}</b></span>)}</div>
  </article>;
}

function WeeklyChart({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const days = snapshot.week.daily;
  const max = Math.max(4, ...days.flatMap((day) => [day.totals.calls, day.totals.messages]));
  const top = Math.ceil(max / 4) * 4;
  const points = (kind: "calls" | "messages") => days.filter((day) => !day.future).map((day, index) => `${40 + index * 70},${205 - day.totals[kind] / top * 180}`);
  return <article className={styles.chartCard}>
    <div className={styles.chartStats}><div><span><i data-series="calls" />Ligações na semana</span><strong>{number.format(snapshot.week.totals.calls)}</strong></div><div><span><i data-series="messages" />Mensagens na semana</span><strong>{number.format(snapshot.week.totals.messages)}</strong></div></div>
    <div className={styles.lineChart}><svg viewBox="0 0 355 245" role="img" aria-label="Ligações e mensagens por dia útil da semana">
      {[0, 1, 2, 3, 4].map((step) => <g key={step}><line x1="40" x2="320" y1={205 - step * 45} y2={205 - step * 45} stroke="#eef0f3" /><text x="27" y={210 - step * 45} textAnchor="end">{number.format(top / 4 * step)}</text></g>)}
      {days.map((day, index) => <g key={day.date}><line x1={40 + index * 70} x2={40 + index * 70} y1="25" y2="205" stroke="#f4f5f7" /><text x={40 + index * 70} y="232" textAnchor="middle">{["SEG", "TER", "QUA", "QUI", "SEX"][index]}</text></g>)}
      {(["calls", "messages"] as const).map((kind) => <g key={kind} stroke={kind === "calls" ? "#4d94e8" : "#20ad88"}><polyline fill="none" strokeWidth="2" strokeLinejoin="round" points={points(kind).join(" ")} />{points(kind).map((point, index) => <circle key={index} cx={point.split(",")[0]} cy={point.split(",")[1]} r="3.7" fill="white" strokeWidth="2.5" />)}</g>)}
    </svg></div><div className={styles.chartCaption}><span aria-hidden="true">ϟ</span> Cada contato é uma nova oportunidade.</div>
  </article>;
}

function MiniPodium({ rows }: Readonly<{ rows: readonly RealtimeDashboardRankingRow[] }>) {
  return <section className={styles.miniPodium}><h3>Top 3 da semana</h3><div className={styles.podiumColumns}>{[1, 0, 2].map((index) => {
    const row = rows[index];
    return <div key={index} className={styles.podiumColumn} data-position={index + 1}>{row ? <><Avatar initials={row.initials} position={row.position} /><strong>{row.name}</strong><span>{number.format(row.actions)} ações</span></> : <><span className={styles.emptyAvatar}>—</span><strong>A definir</strong><span>Sem atividade</span></>}<div className={styles.podiumCylinder}><span>#{index + 1}</span></div></div>;
  })}</div></section>;
}

export function PerformanceDashboard({ snapshot }: Readonly<{ snapshot: RealtimeDashboardSnapshot }>) {
  const totals = snapshot.today.totals;
  const goal = snapshot.week.salesGoal;
  const activities = [
    { icon: "phone" as const, label: "Ligações registradas", detail: "Tentativas realizadas pela equipe", value: totals.calls, tone: "pink" },
    { icon: "message" as const, label: "Mensagens enviadas", detail: "WhatsApp, Instagram e e-mail", value: totals.messages, tone: "amber" },
    { icon: "calendar" as const, label: "Reuniões marcadas", detail: "Agendamentos registrados hoje", value: totals.meetingsScheduled, tone: "green" },
    { icon: "check" as const, label: "Reuniões realizadas", detail: "Conversas que aconteceram hoje", value: totals.meetingsCompleted, tone: "green" },
    { icon: "sale" as const, label: "Vendas conquistadas", detail: formatCents(totals.salesValueCents), value: totals.sales, tone: "blue" },
  ];
  return <div className={styles.performanceGrid}>
    <div className={styles.performanceMain}>
      <div className={styles.performanceHeading}><div><h1>Olá, {snapshot.workspaceName}!</h1><p>Seu painel de desempenho comercial</p></div><span><Icon name="calendar" />Hoje · {snapshot.today.period.fromDate.split("-").reverse().slice(0, 2).join("/")}</span></div>
      <div className={styles.lightMetrics}>
        <article><span>Contatos efetivos</span><div><strong>{number.format(totals.effectiveContacts)}</strong><small>hoje</small><Icon name="people" /></div></article>
        <article><span>Receita conquistada</span><div><strong>{formatCents(totals.salesValueCents)}</strong><small>hoje</small></div></article>
        <article><span>Atividade comercial</span><div><strong>{number.format(totals.calls)}</strong><small>ligações</small><strong>{number.format(totals.messages)}</strong><small>mensagens</small></div></article>
      </div>
      <ActivityFlow snapshot={snapshot} />
      <div className={styles.lightBottom}><ActivityDonut snapshot={snapshot} /><WeeklyChart snapshot={snapshot} /></div>
    </div>
    <aside className={styles.performanceAside} aria-label="Resumo da operação">
      <div className={styles.asideHeading}><h2>Operação de hoje</h2><p>Cada ação aproxima a equipe da meta</p></div>
      <div className={styles.asideMetrics}><article><span>Contatos</span><div><strong>{number.format(totals.effectiveContacts)}</strong><small>efetivos</small><Icon name="message" /></div></article><article><span>Reuniões</span><div><strong>{number.format(totals.meetingsScheduled)}</strong><small>marcadas</small><Icon name="people" /></div></article></div>
      <section className={styles.activityList}><h3>Movimento da equipe <span>[HOJE]</span></h3><ul>{activities.map((activity) => <li key={activity.label}><span className={styles.activityIcon} data-tone={activity.tone}><Icon name={activity.icon} /></span><div><strong>{activity.label}</strong><small>{activity.detail}</small></div><b>{number.format(activity.value)}</b></li>)}</ul></section>
      <MiniPodium rows={snapshot.week.ranking.slice(0, 3)} />
      <div className={styles.weekGoal}><span>Meta semanal</span><strong>{number.format(goal.achieved)} <small>/ {goal.target === null ? "não definida" : number.format(Number(goal.target))}</small></strong><div role="meter" aria-label="Progresso da meta semanal" aria-valuenow={Math.max(0, Math.min(100, (goal.progressBasisPoints ?? 0) / 100))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(0, Math.min(100, (goal.progressBasisPoints ?? 0) / 100))}%` } as CSSProperties} /></div></div>
    </aside>
  </div>;
}
