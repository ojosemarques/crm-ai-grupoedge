import Link from "next/link";

import { CommercialEvolutionChart, CommercialFlowChart, KpiSparkline, RevenueSalesChart } from "@/app/dashboard/dashboard-charts";
import styles from "@/app/dashboard/dashboard.module.css";
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
  const whole = value / 100n;
  const fraction = (value < 0n ? -value : value) % 100n;
  return `R$ ${new Intl.NumberFormat("pt-BR").format(whole)},${fraction.toString().padStart(2, "0")}`;
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
      <strong className={styles.comparisonValue}>{formatValue(comparison.kind, comparison.current.value)}</strong>
      <p className={styles.comparisonDelta}><span aria-hidden="true">{comparison.direction === "UP" ? "↑" : comparison.direction === "DOWN" ? "↓" : "→"}</span>{comparisonSentence(comparison)}</p>
      <KpiSparkline label={comparison.label} series={series} />
      <div className={styles.comparisonFooter}><details className={styles.comparisonFacts}><summary>Comparação</summary><div><p><span>Anterior</span><strong>{formatValue(comparison.kind, comparison.previous.value)}</strong></p><p>{periodLabel(comparison.previousPeriod.fromDate, comparison.previousPeriod.toDate)}</p>{comparison.current.denominator !== null ? <p>Base: {Number(comparison.current.numerator).toLocaleString("pt-BR")} de {comparison.current.denominator.toLocaleString("pt-BR")}</p> : null}</div></details><Link aria-label={`${comparison.label}: abrir registros`} className={styles.cardLink} href={dashboardHref(query, comparison.current.drilldownId)}>Registros <Icon name="seta-direita" size={12} /></Link></div>
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
      {visibleSegments.length === 0 ? <div className={styles.segmentEmpty}>Sem dados para este recorte. Nenhum segmento foi inventado.</div> : (
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
  const max = Math.max(1, ...screen.fullFunnel.stages.map((stage) => stage.value));
  return (
    <section className={`${styles.panel} ${styles.funnelPanel}`}>
      <header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Jornada completa</span><h2>Funil comercial</h2><p>Conversão e perda entre cada marco da coorte.</p></div></header>
      <ol className={styles.funnelList}>
        {screen.fullFunnel.stages.map((stage, index) => {
          const previous = index > 0 ? screen.fullFunnel.stages[index - 1] : null;
          const loss = previous ? Math.max(0, previous.value - stage.value) : null;
          return <li key={stage.id}><Link className={styles.funnelItem} href={dashboardHref(screen.query, stage.drilldownId)}><span className={styles.funnelIdentity}><span className={styles.funnelStep}>{String(index + 1).padStart(2, "0")}</span><span><strong>{stage.id === "received" ? "Entrada" : stage.label}</strong><small>{loss === null ? "Base da coorte" : `Perda de ${loss.toLocaleString("pt-BR")}`}</small></span></span><progress aria-label={`${stage.label}: ${stage.value}`} className={`${styles.funnelTrack} ${styles.funnelBar}`} max={max} value={stage.value} /><span className={styles.funnelConversion}><strong>{stage.value.toLocaleString("pt-BR")}</strong><small>{stage.percentage === null ? "100% da base" : `${stage.percentage.toLocaleString("pt-BR")}% da etapa anterior`}</small></span></Link></li>;
        })}
      </ol>
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
      <header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Ação necessária</span><h2>Precisa de atenção</h2><p>Prioridades para acompanhar hoje.</p></div><span className={styles.attentionTotal}>{total.toLocaleString("pt-BR")}</span></header>
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
      <header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Velocidade</span><h2>SLA humano</h2><p>Política imediata — 0 minutos. As faixas não alteram o prazo.</p></div>{comparison ? <span className={styles.slaTrend} data-interpretation={comparison.interpretation}>{comparisonSentence(comparison)}</span> : null}</header>
      <div className={styles.slaStats}>{statistics.map(([label, value, description]) => <Link href={dashboardHref(screen.query, drilldownId)} key={label}><span>{label}</span><strong>{value}</strong><small>{description}</small></Link>)}</div>
      {comparison ? <p className={styles.slaComparison}>Anterior: <strong>{formatValue(comparison.kind, comparison.previous.value)}</strong> · {periodLabel(comparison.previousPeriod.fromDate, comparison.previousPeriod.toDate)}</p> : null}
    </section>
  );
}

function PerformancePanel({ screen }: Readonly<{ screen: DashboardScreen }>) {
  return (
    <section className={`${styles.panel} ${styles.performancePanel}`}>
      <header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Equipe</span><h2>Performance operacional</h2><p>Contexto por função, sem ranking automático ou inferência causal.</p></div></header>
      {screen.performance.length === 0 ? <div className={styles.segmentEmpty}>Sem atividade atribuída no período.</div> : (
        <div className={styles.performanceScroll}><table className={styles.performanceTable}><thead><tr><th>Pessoa</th><th>Volume</th><th>Conversão</th><th>Receita</th><th>SLA</th><th>Reuniões</th><th>Show rate</th><th><span className={styles.srOnly}>Ação</span></th></tr></thead><tbody>{screen.performance.map((row) => <tr key={`${row.role}:${row.id}`}><td><span className={styles.roleBadge}>{row.role}</span><strong>{row.name}</strong></td><td>{row.volume.toLocaleString("pt-BR")}</td><td>{row.conversionPercentage === null ? "—" : `${row.conversionPercentage.toLocaleString("pt-BR")}%`}</td><td>{formatMoney(row.revenueCents)}</td><td>{formatDuration(row.slaSeconds)}</td><td>{row.meetings.toLocaleString("pt-BR")}</td><td>{row.showRate === null ? "—" : `${row.showRate.toLocaleString("pt-BR")}%`}</td><td><Link href={dashboardHref(screen.query, row.drilldownId)}>Ver registros</Link></td></tr>)}</tbody></table></div>
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
  const scopeLabel = { WORKSPACE: "Todo o workspace", TEAM: "Minha equipe", OWN: "Meus registros" }[screen.overview.scope];
  const focusAction = roleKey === "closer" ? { href: "/agenda", label: "Abrir agenda" } : roleKey === "viewer" ? { href: "/leads", label: "Explorar registros" } : { href: "/meu-dia", label: roleKey === "sdr" ? "Atender agora" : "Ver operação" };
  const currentPeriodLabel = periodLabel(q.fromDate, q.toDate);
  const previousPeriodLabel = periodLabel(screen.comparisonPeriod.fromDate, screen.comparisonPeriod.toDate);

  return (
    <div className={`analytics-canvas ${styles.dashboard}`}>
      <header className={styles.dashboardHeader}>
        <div><p className={styles.eyebrow}>Visão executiva · {scopeLabel}</p><h1>Olá, {displayName.split(/\s+/)[0]}.</h1><p className={styles.headerIntro}>Acompanhe resultado, velocidade e riscos da operação em um só lugar.</p></div>
        <div className={styles.headerActions}><Link className={styles.primaryAction} href={focusAction.href}>{focusAction.label}<Icon name="seta-direita" size={15} /></Link></div>
      </header>

      <section aria-label="Período e filtros do dashboard" className={styles.toolbar}>
        <nav aria-label="Atalhos de período" className={styles.periodNav}>{(["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map((preset) => { const names = { TODAY: "Hoje", YESTERDAY: "Ontem", WEEK: "Semana", MONTH: "Mês" }; return <Link aria-current={q.preset === preset ? "page" : undefined} className={`${styles.periodLink} ${q.preset === preset ? styles.periodActive : ""}`} href={`${basePath}?preset=${preset}`} key={preset}>{names[preset]}</Link>; })}</nav>
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
        <section className={`${styles.panel} ${styles.evolutionPanel}`}><header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Evolução comercial</span><h2>Da entrada à venda</h2><p>Acompanhe o ritmo da operação e compare com o período anterior.</p></div></header><CommercialEvolutionChart currentPeriodLabel={currentPeriodLabel} description="Evolução dos principais marcos comerciais" previousPeriodLabel={previousPeriodLabel} previousSeries={screen.previousTimeSeries} series={screen.timeSeries} title="Evolução comercial" /></section>
        <AttentionPanel items={screen.attention} query={q} />
      </div>

      <section className={styles.pulseStrip} aria-label="Marcos operacionais do período">{operationalPulse.map((metric) => <Link href={dashboardHref(q, metric.drilldownId)} key={metric.id}><span>{metric.label}</span><strong>{metricValue(metric)}</strong><small>{metric.denominator === null ? `${metric.numerator} registros` : `${metric.numerator} de ${metric.denominator}`}</small></Link>)}</section>

      <section className={`${styles.panel} ${styles.flowPanel}`}><header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Volume por marco</span><h2>Movimento do funil no período</h2><p>Volume de entradas, qualificações, agendamentos e vendas ao longo do período.</p></div></header><CommercialFlowChart series={screen.timeSeries} /></section>

      <div className={styles.commercialGrid}>
        <section className={`${styles.panel} ${styles.revenuePanel}`}><header className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Receita e vendas</span><h2>Resultado ao longo do tempo</h2><p>Explore a receita gerada e a evolução das vendas.</p></div><span className={styles.ticketBadge}>Ticket {formatMoney(screen.overview.averageTicket.cents)}</span></header><RevenueSalesChart currentPeriodLabel={currentPeriodLabel} description="Receita e vendas por bucket temporal" previousPeriodLabel={previousPeriodLabel} previousSeries={screen.previousTimeSeries} series={screen.timeSeries} title="Receita e vendas" /></section>
        <FunnelPanel screen={screen} />
      </div>

      <SlaPanel screen={screen} />

      <section aria-labelledby="acquisition-title"><header className={styles.sectionHeader}><div><span className={styles.sectionTag}>Aquisição e qualidade</span><h2 id="acquisition-title">De onde vem o resultado</h2><p>Volume, conversão e qualidade da entrada em leituras separadas.</p></div></header><div className={styles.analysisGrid}><SegmentList description="Ganhos vigentes sobre os leads recebidos da origem." limit={6} query={q} segments={screen.sourceConversion} title="Conversão por origem" /><SegmentList description="Distribuição vigente entre P1, P2 e P3." limit={3} query={q} segments={screen.priorities} title="Prioridade da entrada" tone="soft" /><SegmentList description="Completude humana da coorte recebida." limit={5} query={q} segments={screen.pactoQuality} title="Qualidade do PACTO" /></div></section>

      <PerformancePanel screen={screen} />

      <details className={styles.details}><summary>Explorar análises complementares <span>Campanhas, criativos, etapas, motivos e aging</span></summary><div className={styles.detailsContent}><SegmentList description="Volume de leads recebidos por origem." query={q} segments={screen.sources} title="Origem dos leads" /><SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.campaigns} title="Campanhas" /><SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.creatives} title="Criativos" /><SegmentList description="Entradas históricas por etapa e pipeline." query={q} segments={screen.stageConversion} title="Conversão por etapa" /><SegmentList description="Tempo médio calculado pelo histórico de etapas." query={q} secondaryKind="DURATION" segments={screen.stageTime} title="Tempo por etapa" /><SegmentList description="Eventos de desqualificação no período." query={q} segments={screen.disqualificationReasons} title="Motivos de desqualificação" /><SegmentList description="Perdas vigentes ocorridas no período." query={q} segments={screen.lossReasons} title="Motivos de perda" /><SegmentList description="Último estado persistido das reuniões decididas." query={q} segments={screen.noShowReasons} title="Motivos de no-show" /><SegmentList description="Leads em intervalo aberto no corte." query={q} segments={screen.backlogByStage} title="Backlog por etapa" /><SegmentList description="Tempo médio dos negócios em cada etapa." query={q} secondaryKind="DURATION" segments={screen.agingByStage} title="Aging por etapa" /></div></details>
    </div>
  );
}
