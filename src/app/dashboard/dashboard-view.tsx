import Link from "next/link";

import { CommercialEvolutionChart, CommercialFlowChart, KpiSparkline, RevenueSalesChart } from "@/app/dashboard/dashboard-charts";
import styles from "@/app/dashboard/dashboard.module.css";
import { ConnectedFunnel, StageDistribution } from "./dashboard-visuals";
import { Icon, type IconName } from "@/components/ui/icon";
import type {
  DashboardAttentionItem,
  DashboardComparison,
  DashboardKpi,
  DashboardQuery,
  DashboardScreen,
  DashboardSegment,
  DashboardTimeSeries,
} from "@/modules/metrics/domain/dashboard-contracts";
import type { CanonicalMetricValue } from "@/modules/metrics/domain/metrics-contracts";
import { integratedMetricRegistry } from "@/modules/metrics/domain/integrated-metric-registry";

function paramsFor(query: DashboardQuery, extras: Record<string, string> = {}) {
  const params = new URLSearchParams({ preset: query.preset, fromDate: query.fromDate, toDate: query.toDate, ...extras });
  const mappings = [
    ["sdr", query.filters.sdrMemberIds], ["closer", query.filters.closerMemberIds],
    ["team", query.filters.teamIds], ["source", query.filters.sourceIds],
    ["campaign", query.filters.campaignIds], ["creative", query.filters.creativeIds],
    ["priority", query.filters.priorityCodes], ["product", query.filters.productIds],
  ] as const;
  for (const [name, values] of mappings) for (const value of values) params.append(name, value);
  return params;
}

export function dashboardHref(query: DashboardQuery, view: string) {
  return `/dashboard/registros?${paramsFor(query, { view }).toString()}`;
}

function formatMoney(cents: string | null) {
  if (cents === null) return "—";
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${value < 0n ? "−" : ""}R$ ${new Intl.NumberFormat("pt-BR").format(whole)},${fraction.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Sem medição";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours < 24) return `${hours}h ${minutes}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatValue(kind: DashboardKpi["kind"], value: number | string | null) {
  if (kind === "MONEY") return formatMoney(typeof value === "string" ? value : null);
  if (kind === "DURATION") return formatDuration(typeof value === "number" ? value : null);
  if (kind === "RATE") return value === null ? "—" : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function integratedValue(metric: CanonicalMetricValue) {
  if (metric.state === "NO_DENOMINATOR") return "Sem base";
  if (metric.unit === "CENTS") return formatMoney(typeof metric.value === "string" ? metric.value : null);
  if (metric.unit === "BASIS_POINTS") return metric.value === null ? "—" : `${(Number(metric.value) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (metric.unit === "SECONDS") return formatDuration(typeof metric.value === "number" ? metric.value : null);
  return Number(metric.value ?? 0).toLocaleString("pt-BR");
}

function integratedHref(query: DashboardQuery, metricId: string) {
  const params = new URLSearchParams({ metricId, from: query.from, to: query.to });
  const mappings = [
    ["sdrMemberIds", query.filters.sdrMemberIds], ["closerMemberIds", query.filters.closerMemberIds], ["teamIds", query.filters.teamIds],
    ["sourceIds", query.filters.sourceIds], ["campaignIds", query.filters.campaignIds], ["creativeIds", query.filters.creativeIds],
  ] as const;
  for (const [key, values] of mappings) for (const value of values) params.append(key, value);
  return `/api/metrics/integrated/drilldown?${params.toString()}`;
}

function metricValue(metric: DashboardKpi) {
  return formatValue(metric.kind, metric.value);
}

function periodLabel(fromDate: string, toDate: string) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${fromDate}T12:00:00Z`))} — ${formatter.format(new Date(`${toDate}T12:00:00Z`))}`;
}

function generatedLabel(generatedAt: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(generatedAt));
}

function comparisonSentence(comparison: DashboardComparison) {
  if (comparison.direction === "NOT_COMPARABLE") return "Sem comparação anterior";
  if (comparison.direction === "STABLE") return "Sem variação no período";
  const direction = comparison.direction === "UP" ? "acima" : "abaixo";
  if (comparison.percentageDifference === null) return comparison.direction === "UP" ? "Crescimento no período" : "Queda no período";
  const percentage = Math.abs(comparison.percentageDifference).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${percentage}% ${direction} do período anterior`;
}

const comparisonIcons: Readonly<Record<string, IconName>> = {
  revenue: "receita",
  sales: "tendencia",
  "lead-to-sale": "pipeline",
  "sla-median": "relogio",
};

function ComparisonCard({ comparison, featured, query, series }: Readonly<{ comparison: DashboardComparison; featured?: boolean; query: DashboardQuery; series: DashboardTimeSeries | undefined }>) {
  return (
    <article className={`${styles.comparisonCard} ${featured ? styles.comparisonFeatured : ""}`} data-interpretation={comparison.interpretation}>
      <div className={styles.comparisonHeader}><span>{comparison.label}</span><span className={styles.comparisonIcon}><Icon name={comparisonIcons[comparison.id] ?? "tendencia"} size={15} /></span></div>
      <div className={styles.comparisonMeasure}><Link aria-label={`${comparison.label}: ver fórmula e registros`} href={dashboardHref(query, comparison.current.drilldownId)}><strong className={styles.comparisonValue}>{formatValue(comparison.kind, comparison.current.value)}</strong></Link><KpiSparkline label={comparison.label} series={series} /></div>
      <p className={styles.comparisonDelta}><span aria-hidden="true">{comparison.direction === "UP" ? "↑" : comparison.direction === "DOWN" ? "↓" : "→"}</span>{comparisonSentence(comparison)}</p>
      <div className={styles.comparisonFooter}><details className={styles.comparisonFacts}><summary>Comparação</summary><div><p><span>Anterior</span><Link href={dashboardHref(query, comparison.previous.drilldownId)}><strong>{formatValue(comparison.kind, comparison.previous.value)}</strong></Link></p><p>{periodLabel(comparison.previousPeriod.fromDate, comparison.previousPeriod.toDate)}</p>{comparison.current.denominator !== null ? <p>Base: {Number(comparison.current.numerator).toLocaleString("pt-BR")} de {comparison.current.denominator.toLocaleString("pt-BR")}</p> : null}</div></details><Link aria-label={`${comparison.label}: abrir registros`} className={styles.cardLink} href={dashboardHref(query, comparison.current.drilldownId)}>Registros <Icon name="seta-direita" size={12} /></Link></div>
    </article>
  );
}

function SelectFilter({ name, label, options, selected }: Readonly<{ name: string; label: string; options: readonly Readonly<{ id: string; name: string }>[]; selected: readonly string[] }>) {
  return <label className={styles.field}>{label}<select defaultValue={selected} multiple name={name}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

function SegmentList({ title, description, segments, query, secondaryKind = "COUNT", limit, tone = "default" }: Readonly<{
  title: string;
  description: string;
  segments: readonly DashboardSegment[];
  query: DashboardQuery;
  secondaryKind?: "COUNT" | "DURATION" | "MONEY";
  limit?: number;
  tone?: "default" | "soft";
}>) {
  const visibleSegments = limit ? segments.slice(0, limit) : segments;
  const max = Math.max(1, ...visibleSegments.map((segment) => segment.value));
  return (
    <section className={`${styles.panel} ${tone === "soft" ? styles.panelSoft : ""}`}>
      <header className={styles.panelHeader}><div><h2>{title}</h2><p>{description}</p></div></header>
      {visibleSegments.length === 0 ? <div className={styles.segmentEmpty}>Sem dados para este recorte.</div> : (
        <ol className={styles.segmentList}>
          {visibleSegments.map((segment) => {
            const secondary = segment.secondaryValue === null ? null : secondaryKind === "DURATION" ? formatDuration(Number(segment.secondaryValue)) : secondaryKind === "MONEY" ? formatMoney(String(segment.secondaryValue)) : new Intl.NumberFormat("pt-BR").format(Number(segment.secondaryValue));
            return <li key={segment.id}><Link className={styles.segmentLink} href={dashboardHref(query, segment.drilldownId)}><span className={styles.segmentRow}><span>{segment.label}</span><strong>{segment.value.toLocaleString("pt-BR")}{segment.percentage !== null ? ` · ${segment.percentage.toLocaleString("pt-BR")}%` : ""}</strong></span><progress aria-label={`${segment.label}: ${segment.value}`} className={`${styles.barTrack} ${styles.barFill}`} max={max} value={segment.value} />{secondary !== null ? <span className={styles.segmentMeta}>{segment.secondaryLabel}: {secondary}</span> : null}</Link></li>;
          })}
        </ol>
      )}
    </section>
  );
}

function FunnelPanel({ screen }: Readonly<{ screen: DashboardScreen }>) {
  return (
    <section className={`${styles.panel} ${styles.funnelPanel}`}>
      <header className={styles.panelHeader}><div><h2>Seu funil, do primeiro contato à venda</h2><p>Volume de leads que alcançaram cada marco da jornada.</p></div></header>
      <ConnectedFunnel stages={screen.fullFunnel.stages.map((stage) => ({ ...stage, href: dashboardHref(screen.query, stage.drilldownId) }))} />
      <div className={styles.outcomeGrid} aria-label="Desfechos do funil">
        {screen.fullFunnel.outcomes.map((outcome) => <Link className={styles.outcome} data-outcome={outcome.id} href={dashboardHref(screen.query, outcome.drilldownId)} key={outcome.id}><span>{outcome.label}</span><strong>{outcome.value.toLocaleString("pt-BR")}</strong><small>{outcome.percentage === null ? "Sem denominador" : `${outcome.percentage.toLocaleString("pt-BR")}% a partir de ${outcome.branchFrom === "received" ? "Entrada" : "Proposta"}`}</small></Link>)}
      </div>
    </section>
  );
}

function AttentionPanel({ items, query }: Readonly<{ items: readonly DashboardAttentionItem[]; query: DashboardQuery }>) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className={`${styles.panel} ${styles.attentionPanel}`}>
      <header className={styles.panelHeader}><div><h2>Prioridades de hoje</h2><p>Prioridades para acompanhar hoje.</p></div><span className={styles.attentionTotal}>{total.toLocaleString("pt-BR")}</span></header>
      <ol className={styles.attentionList}>{items.map((item) => <li key={item.id}><Link className={styles.attentionLink} data-severity={item.severity} href={dashboardHref(query, item.drilldownId)}><span className={styles.attentionMark}><Icon name={item.severity === "INFO" ? "automacoes" : "alerta"} size={16} /></span><span className={styles.attentionText}><strong>{item.label}</strong><span>{item.detail}</span></span><span className={styles.attentionValue}>{item.value.toLocaleString("pt-BR")}</span></Link></li>)}</ol>
    </section>
  );
}

function SlaPanel({ screen }: Readonly<{ screen: DashboardScreen }>) {
  const sla = screen.overview.humanSla;
  const comparison = screen.comparisons.find((item) => item.id === "sla-median");
  const drilldownId = comparison?.current.drilldownId ?? screen.kpis.find((item) => item.id === "sla")?.drilldownId ?? "kpi.sla";
  const statistics = [
    ["Mediana", formatDuration(sla.medianSeconds), "Metade das tentativas ocorreu até este tempo"],
    ["P90", formatDuration(sla.p90Seconds), "90% das tentativas ocorreu até este tempo"],
    ["Até 60 segundos", sla.upTo60Seconds.toLocaleString("pt-BR"), "Faixa saudável"],
    ["Até 180 segundos", sla.upTo180Seconds.toLocaleString("pt-BR"), "Acumulado até o limite de atenção"],
    ["Sem tentativa", sla.missingCount.toLocaleString("pt-BR"), "Entradas ainda sem medição humana"],
  ] as const;
  return (
    <section className={`${styles.panel} ${styles.slaPanel}`}>
      <header className={styles.panelHeader}><div><h2>Velocidade de atendimento</h2><p>SLA humano imediato. Acompanhe o tempo até a primeira tentativa.</p></div>{comparison ? <span className={styles.slaTrend} data-interpretation={comparison.interpretation}>{comparisonSentence(comparison)}</span> : null}</header>
      <div className={styles.slaStats}>{statistics.map(([label, value, description]) => <Link href={dashboardHref(screen.query, drilldownId)} key={label}><span>{label}</span><strong>{value}</strong><small>{description}</small></Link>)}</div>
      {comparison ? <p className={styles.slaComparison}>Anterior: <strong>{formatValue(comparison.kind, comparison.previous.value)}</strong> · {periodLabel(comparison.previousPeriod.fromDate, comparison.previousPeriod.toDate)}</p> : null}
    </section>
  );
}

function PerformancePanel({ screen }: Readonly<{ screen: DashboardScreen }>) {
  return (
    <section className={`${styles.panel} ${styles.performancePanel}`}>
      <header className={styles.panelHeader}><div><h2>Performance da equipe</h2><p>Resultados e ritmo de atendimento de cada pessoa.</p></div></header>
      {screen.performance.length === 0 ? <div className={styles.segmentEmpty}>Sem atividade atribuída no período.</div> : (
        <div className={styles.performanceScroll}><table className={styles.performanceTable}><thead><tr><th>Pessoa</th><th>Volume</th><th>Conversão</th><th>Receita</th><th>SLA</th><th>Reuniões</th><th>Show rate</th><th><span className={styles.srOnly}>Ação</span></th></tr></thead><tbody>{screen.performance.map((row) => { const href = dashboardHref(screen.query, row.drilldownId); return <tr key={`${row.role}:${row.id}`}><td><span className={styles.roleBadge}>{row.role}</span><strong>{row.name}</strong></td><td><Link href={href}>{row.volume.toLocaleString("pt-BR")}</Link></td><td><Link href={href}>{row.conversionPercentage === null ? "—" : `${row.conversionPercentage.toLocaleString("pt-BR")}%`}</Link></td><td><Link href={href}>{formatMoney(row.revenueCents)}</Link></td><td><Link href={href}>{formatDuration(row.slaSeconds)}</Link></td><td><Link href={href}>{row.meetings.toLocaleString("pt-BR")}</Link></td><td><Link href={href}>{row.showRate === null ? "—" : `${row.showRate.toLocaleString("pt-BR")}%`}</Link></td><td><Link href={href}>Ver registros</Link></td></tr>; })}</tbody></table></div>
      )}
    </section>
  );
}

export function DashboardView({ basePath, displayName, roleKey, roleName, screen }: Readonly<{ basePath: "/" | "/dashboard"; displayName: string; roleKey: string; roleName: string; screen: DashboardScreen }>) {
  const q = screen.query;
  const activeFilterCount = Object.values(q.filters).reduce((total, values) => total + values.length, 0);
  const activeFilterGroups = [
    q.filters.sdrMemberIds.length > 0 ? `${q.filters.sdrMemberIds.length} SDR` : null,
    q.filters.closerMemberIds.length > 0 ? `${q.filters.closerMemberIds.length} closer` : null,
    q.filters.teamIds.length > 0 ? `${q.filters.teamIds.length} equipe` : null,
    q.filters.sourceIds.length > 0 ? `${q.filters.sourceIds.length} origem` : null,
    q.filters.campaignIds.length > 0 ? `${q.filters.campaignIds.length} campanha` : null,
    q.filters.creativeIds.length > 0 ? `${q.filters.creativeIds.length} criativo` : null,
    q.filters.priorityCodes.length > 0 ? q.filters.priorityCodes.join(", ") : null,
    q.filters.productIds.length > 0 ? `${q.filters.productIds.length} produto` : null,
  ].filter((value): value is string => value !== null);
  const comparisonById = new Map(screen.comparisons.map((comparison) => [comparison.id, comparison]));
  const primaryComparisons = ["revenue", "sales", "lead-to-sale", "sla-median"].flatMap((id) => comparisonById.get(id) ?? []);
  const kpiById = new Map(screen.kpis.map((metric) => [metric.id, metric]));
  const operationalPulse = ["leads", "connected", "qualified", "scheduled", "opportunities", "proposals"].flatMap((id) => kpiById.get(id) ?? []);
  const integratedMetricIds = ["work.tasks_completed", "outreach.calls_attempted", "outreach.call_connection_rate", "email.sent", "email.delivery_rate", "outreach.inbound_responses", "meetings.completed", "sales.bookings", "cash.received"];
  const integratedPulse = integratedMetricIds.flatMap((id) => screen.integrated.values.find((metric) => metric.metricId === id) ?? []);
  const integratedLabelById = new Map(integratedMetricRegistry.map((metric) => [metric.id, metric.label]));
  const ticketKpi = kpiById.get("ticket");
  const scopeLabel = { WORKSPACE: "Todo o workspace", TEAM: "Minha equipe", OWN: "Meus registros" }[screen.overview.scope];
  const focusAction = roleKey === "closer" ? { href: "/agenda", label: "Abrir agenda" } : roleKey === "viewer" ? { href: "/leads", label: "Explorar registros" } : { href: "/meu-dia", label: roleKey === "sdr" ? "Atender agora" : "Ver operação" };
  const currentPeriodLabel = periodLabel(q.fromDate, q.toDate);
  const previousPeriodLabel = periodLabel(screen.comparisonPeriod.fromDate, screen.comparisonPeriod.toDate);

  return (
    <div className={styles.dashboard}>
      <header className={styles.dashboardHeader}>
        <div><p className={styles.eyebrow}>{scopeLabel}</p><h1>Bom trabalho, {displayName.split(/\s+/)[0]}.</h1><p className={styles.headerIntro}>Veja seus resultados e acompanhe o que vem a seguir.</p></div>
        <div className={styles.headerActions}><Link className={styles.primaryAction} href={focusAction.href}>{focusAction.label}<Icon name="seta-direita" size={15} /></Link></div>
      </header>

      <section aria-label="Período e filtros do dashboard" className={styles.toolbar}>
        <nav aria-label="Atalhos de período" className={styles.periodNav}>{(["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map((preset) => { const names = { TODAY: "Hoje", YESTERDAY: "Ontem", WEEK: "Semana", MONTH: "Mês" }; return <Link aria-current={q.preset === preset ? "page" : undefined} className={`${styles.periodLink} ${q.preset === preset ? styles.periodActive : ""}`} href={`${basePath}?${paramsFor({ ...q, preset }).toString()}`} key={preset}>{names[preset]}</Link>; })}</nav>
        <div className={styles.contextInline}><strong>{currentPeriodLabel}</strong><details><summary>Comparado ao período anterior</summary><div><p><span>Anterior</span>{previousPeriodLabel}</p><p><span>Filtros</span>{activeFilterGroups.length > 0 ? activeFilterGroups.join(" · ") : "Todos os registros"}</p><p><span>Atualização</span>{generatedLabel(screen.overview.generatedAt, screen.overview.period.timeZone)}</p><p>{roleName} · {screen.overview.period.timeZone}</p></div></details></div>
        <details className={styles.filterDetails} open={activeFilterCount > 0 || q.preset === "CUSTOM"}>
          <summary className={styles.filterSummary}><Icon name="filtro" size={15} /> Filtros{activeFilterCount > 0 ? <span className={styles.filterCount}>{activeFilterCount}</span> : null}</summary>
          <div className={styles.filterPanel}><div className={styles.filterPanelHeader}><div><strong>Refinar análise</strong><span>O mesmo recorte será preservado nos indicadores e drilldowns.</span></div></div><form className={styles.filterForm} method="get">
            <label className={styles.field}>Período<select defaultValue={q.preset} name="preset"><option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana atual</option><option value="MONTH">Mês atual</option><option value="CUSTOM">Personalizado</option></select></label>
            <label className={styles.field}>Data inicial<input defaultValue={q.fromDate} name="fromDate" type="date" /></label><label className={styles.field}>Data final<input defaultValue={q.toDate} name="toDate" type="date" /></label>
            <SelectFilter label="Prioridade" name="priority" options={screen.filterOptions.priorities} selected={q.filters.priorityCodes} /><SelectFilter label="SDR" name="sdr" options={screen.filterOptions.sdrs} selected={q.filters.sdrMemberIds} /><SelectFilter label="Closer" name="closer" options={screen.filterOptions.closers} selected={q.filters.closerMemberIds} /><SelectFilter label="Equipe" name="team" options={screen.filterOptions.teams} selected={q.filters.teamIds} /><SelectFilter label="Origem" name="source" options={screen.filterOptions.sources} selected={q.filters.sourceIds} /><SelectFilter label="Campanha" name="campaign" options={screen.filterOptions.campaigns} selected={q.filters.campaignIds} /><SelectFilter label="Criativo" name="creative" options={screen.filterOptions.creatives} selected={q.filters.creativeIds} /><SelectFilter label="Produto" name="product" options={screen.filterOptions.products} selected={q.filters.productIds} />
            <div className={styles.filterActions}><Link className={styles.filterClear} href={`${basePath}?preset=MONTH`}>Limpar</Link><button className={styles.filterApply} type="submit">Aplicar filtros</button></div>
          </form></div>
        </details>
      </section>

      {!screen.hasData ? <section className={styles.emptyState}><Icon name="tendencia" size={22} /><div><h2>Nenhum dado no período</h2><p>Selecione outro período ou ajuste os filtros para explorar seus resultados.</p></div></section> : null}

      <section aria-label="Indicadores principais"><div className={styles.comparisonGrid}>{primaryComparisons.map((comparison, index) => <ComparisonCard comparison={comparison} featured={index === 0} key={comparison.id} query={q} series={screen.timeSeries.find((series) => series.id === comparison.id)} />)}</div></section>

      <div className={styles.primaryGrid}>
        <section className={`${styles.panel} ${styles.evolutionPanel}`}><header className={styles.panelHeader}><div><h2>Evolução comercial</h2><p>O ritmo da operação, dia após dia.</p></div><span className={styles.headerIcon}><Icon name="tendencia" size={16} /></span></header><CommercialEvolutionChart currentPeriodLabel={currentPeriodLabel} description="Evolução dos principais marcos comerciais" previousPeriodLabel={previousPeriodLabel} previousSeries={screen.previousTimeSeries} series={screen.timeSeries} title="Evolução comercial" /></section>
        <StageDistribution segments={screen.backlogByStage.map((stage) => ({ ...stage, href: dashboardHref(q, stage.drilldownId) }))} totalHref={kpiById.get("backlog") ? dashboardHref(q, kpiById.get("backlog")!.drilldownId) : undefined} />
      </div>

      <FunnelPanel screen={screen} />

      <div className={styles.commercialGrid}>
        <div className={styles.resultsStack}>
          <section className={`${styles.panel} ${styles.revenuePanel}`}><header className={styles.panelHeader}><div><h2>Receita e vendas</h2><p>Resultados que movimentam o seu negócio.</p></div>{ticketKpi?<Link className={styles.ticketBadge} href={dashboardHref(q,ticketKpi.drilldownId)}>Ticket médio <strong>{formatMoney(screen.overview.averageTicket.cents)}</strong></Link>:<span className={styles.ticketBadge}>Ticket médio <strong>{formatMoney(screen.overview.averageTicket.cents)}</strong></span>}</header><RevenueSalesChart currentPeriodLabel={currentPeriodLabel} description="Receita e vendas por período" previousPeriodLabel={previousPeriodLabel} previousSeries={screen.previousTimeSeries} series={screen.timeSeries} title="Receita e vendas" /></section>
          <section className={styles.pulseStrip} aria-label="Marcos operacionais do período">{operationalPulse.map((metric) => <Link href={dashboardHref(q, metric.drilldownId)} key={metric.id}><span>{metric.label}</span><strong>{metricValue(metric)}</strong><small>{metric.denominator === null ? `${metric.numerator} registros` : `${metric.numerator} de ${metric.denominator}`}</small></Link>)}</section>
        </div>
        <AttentionPanel items={screen.attention} query={q} />
      </div>

      <PerformancePanel screen={screen} />

      <section className={`${styles.panel} ${styles.integratedPanel}`}>
        <header className={styles.panelHeader}><div><h2>Operação integrada</h2><p>Atividade, contato, e-mail, reuniões e receita na mesma base auditável.</p></div><span className={styles.qualityBadge} data-state={screen.integrated.quality.reconciliationState}>{screen.integrated.quality.coverageBasisPoints === null ? "Cobertura pendente" : `${(screen.integrated.quality.coverageBasisPoints / 100).toLocaleString("pt-BR")}% atribuída`}</span></header>
        <div className={styles.integratedGrid}>{integratedPulse.map((metric) => <a href={integratedHref(q, metric.metricId)} key={metric.metricId}><span>{integratedLabelById.get(metric.metricId) ?? metric.metricId}</span><strong>{integratedValue(metric)}</strong><small data-state={metric.state}>{metric.state === "NO_DENOMINATOR" ? "Sem denominador elegível" : metric.reason}</small></a>)}</div>
        <p className={styles.qualityNote}>{screen.integrated.quality.reason} · {screen.integrated.quality.totalFacts.toLocaleString("pt-BR")} fatos no recorte.</p>
      </section>

      <section className={`${styles.panel} ${styles.flowPanel}`}><header className={styles.panelHeader}><div><h2>Atividade ao longo do período</h2><p>Entradas, qualificações, agendamentos e vendas.</p></div></header><CommercialFlowChart series={screen.timeSeries} /></section>

      <SlaPanel screen={screen} />

      <section aria-labelledby="acquisition-title"><header className={styles.sectionHeader}><div><span className={styles.sectionTag}>Aquisição e qualidade</span><h2 id="acquisition-title">De onde vem o resultado</h2><p>Volume, conversão e qualidade da entrada em leituras separadas.</p></div></header><div className={styles.analysisGrid}><SegmentList description="Ganhos vigentes sobre os leads recebidos da origem." limit={6} query={q} segments={screen.sourceConversion} title="Conversão por origem" /><SegmentList description="Distribuição vigente entre P1, P2 e P3." limit={3} query={q} segments={screen.priorities} title="Prioridade da entrada" tone="soft" /><SegmentList description="Completude humana da coorte recebida." limit={5} query={q} segments={screen.pactoQuality} title="Qualidade do PACTO" /></div></section>

      <details className={styles.details}><summary>Explorar análises complementares <span>Campanhas, criativos, etapas, motivos e aging</span></summary><div className={styles.detailsContent}><SegmentList description="Volume de leads recebidos por origem." query={q} segments={screen.sources} title="Origem dos leads" /><SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.campaigns} title="Campanhas" /><SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.creatives} title="Criativos" /><SegmentList description="Entradas históricas por etapa e pipeline." query={q} segments={screen.stageConversion} title="Conversão por etapa" /><SegmentList description="Tempo médio calculado pelo histórico de etapas." query={q} secondaryKind="DURATION" segments={screen.stageTime} title="Tempo por etapa" /><SegmentList description="Eventos de desqualificação no período." query={q} segments={screen.disqualificationReasons} title="Motivos de desqualificação" /><SegmentList description="Perdas vigentes ocorridas no período." query={q} segments={screen.lossReasons} title="Motivos de perda" /><SegmentList description="Último estado persistido das reuniões decididas." query={q} segments={screen.noShowReasons} title="Motivos de no-show" /><SegmentList description="Leads em intervalo aberto no corte." query={q} segments={screen.backlogByStage} title="Backlog por etapa" /><SegmentList description="Tempo médio dos negócios em cada etapa." query={q} secondaryKind="DURATION" segments={screen.agingByStage} title="Aging por etapa" /></div></details>
    </div>
  );
}
