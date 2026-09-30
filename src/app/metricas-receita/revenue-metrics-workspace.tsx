import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, Surface, DataTableShell } from "@/components/ui/surface";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { RevenueDrilldownPage, RevenueMetricState, RevenueMetricsScreen } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueMetricRegistryById } from "@/modules/metrics/domain/revenue-metric-registry";
import { RevenueSeriesChart } from "./revenue-metrics-charts";
import styles from "./revenue-metrics.module.css";

const stateLabels: Record<RevenueMetricState, string> = { AVAILABLE: "Disponível", ZERO: "Zero", NO_DENOMINATOR: "Sem denominador", UNAVAILABLE: "Indisponível", NOT_APPLICABLE: "Não aplicável", PARTIAL: "Parcial", SUPPRESSED: "Suprimido" };
const stateTones: Record<RevenueMetricState, StatusTone> = { AVAILABLE: "success", ZERO: "neutral", NO_DENOMINATOR: "warning", UNAVAILABLE: "warning", NOT_APPLICABLE: "neutral", PARTIAL: "warning", SUPPRESSED: "danger" };
const sections = [{ id: "summary", label: "Resumo" }, { id: "mrr", label: "MRR" }, { id: "retention", label: "Retenção" }, { id: "forecast", label: "Forecast" }, { id: "quality", label: "Qualidade" }, { id: "catalog", label: "Definições" }] as const;
const filterNames = {
  sdrMemberIds: "sdr",
  closerMemberIds: "closer",
  teamIds: "team",
  sourceIds: "source",
  campaignIds: "campaign",
  creativeIds: "creative",
  priorityCodes: "priority",
  productIds: "product",
} as const;

function formatMetric(metricId: string, value: string | number | null) {
  if (value === null) return "—";
  const definition = revenueMetricRegistryById.get(metricId);
  if (definition?.unit === "CENTS") {
    const cents = BigInt(value);
    const absolute = cents < 0n ? -cents : cents;
    return `${cents < 0n ? "−" : ""}R$ ${new Intl.NumberFormat("pt-BR").format(absolute / 100n)},${(absolute % 100n).toString().padStart(2, "0")}`;
  }
  if (definition?.unit === "BASIS_POINTS") return `${(Number(value) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (definition?.unit === "SECONDS") return `${Number(value).toLocaleString("pt-BR")} s`;
  return Number(value).toLocaleString("pt-BR");
}

function persistedQuery(screen: RevenueMetricsScreen) {
  const query = new URLSearchParams({
    preset: screen.query.preset,
    fromDate: screen.query.period.fromDate,
    toDate: screen.query.period.toDate,
  });
  for (const [filter, parameter] of Object.entries(filterNames)) {
    for (const value of screen.query.filters[filter as keyof typeof filterNames]) {
      query.append(parameter, value);
    }
  }
  return query;
}

function sectionHref(query: URLSearchParams, section: string, metric?: string) {
  const href = new URLSearchParams(query);
  href.set("section", section);
  if (metric) href.set("metric", metric);
  return `/metricas-receita?${href}`;
}

function MetricCards({ screen, ids }: Readonly<{ screen: RevenueMetricsScreen; ids: readonly string[] }>) {
  const byId = new Map(screen.metrics.map((item) => [item.metricId, item]));
  const comparisons = new Map(screen.comparisons.map((item) => [item.metricId, item]));
  const query = persistedQuery(screen);
  return <div className={styles.metricGrid}>{ids.map((id) => {
    const item = byId.get(id);
    const definition = revenueMetricRegistryById.get(id);
    if (!item || !definition) return null;
    const comparison = comparisons.get(id);
    const change = comparison?.percentageDifferenceBasisPoints;
    const trend = change === null || change === undefined ? "Sem base comparável" : `${comparison?.direction === "UP" ? "↑" : comparison?.direction === "DOWN" ? "↓" : "→"} ${Math.abs(change / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% vs. período anterior`;
    const content = <><span className={styles.metricLabel}>{definition.name}</span><strong className={styles.metricValue}>{formatMetric(id, item.value)}</strong><span className={styles.metricTrend} data-interpretation={comparison?.interpretation}>{trend}</span><span className={styles.metricFoot}><State state={item.state} /><small>{definition.description}</small></span></>;
    return item.drilldownId ? <Link className={styles.metricCard} href={sectionHref(query, "drilldown", id)} key={id}>{content}</Link> : <article className={styles.metricCard} key={id}>{content}</article>;
  })}</div>;
}

function State({ state }: Readonly<{ state: RevenueMetricState }>) { return <StatusBadge tone={stateTones[state]}>{stateLabels[state]}</StatusBadge>; }

function SeriesPanel({ screen, metricId, title, description, variant = "area" }: Readonly<{ screen: RevenueMetricsScreen; metricId: string; title: string; description: string; variant?: "area" | "bar" }>) {
  const source = screen.series.find((item) => item.metricId === metricId);
  return <Surface className={styles.chartPanel}><SectionHeader eyebrow="Série histórica" title={title} description={description} /><RevenueSeriesChart metricId={metricId} series={screen.series} variant={variant} /><details className={styles.chartDetails}><summary>Consultar valores por período</summary><DataTableShell className="mt-3"><table><thead><tr><th>Período</th><th>Valor</th><th>Estado</th></tr></thead><tbody>{source?.points.map((point) => <tr key={point.bucket}><td>{point.bucket}</td><td>{formatMetric(metricId, point.value)}</td><td><State state={point.state} /></td></tr>)}</tbody></table></DataTableShell></details></Surface>;
}

function BridgePanel({ screen }: Readonly<{ screen: RevenueMetricsScreen }>) {
  const bridge = screen.bridge;
  const entries = [
    { label: "MRR inicial", value: bridge.openingMrrCents, tone: "neutral" },
    { label: "New + expansão + reativação", value: (BigInt(bridge.newMrrCents) + BigInt(bridge.expansionMrrCents) + BigInt(bridge.reactivationMrrCents)).toString(), tone: "positive" },
    { label: "Contração + churn", value: (-(BigInt(bridge.contractionMrrCents) + BigInt(bridge.churnMrrCents))).toString(), tone: "negative" },
    { label: "Ajustes", value: bridge.adjustmentsCents, tone: "neutral" },
    { label: "MRR final", value: bridge.closingMrrCents, tone: "final" },
  ] as const;
  return <Surface className={styles.bridgePanel}><SectionHeader eyebrow="Ponte reconciliada" title="Movimentação do MRR" description="Saldo inicial, movimentos e saldo final com seus sinais reais." action={<StatusBadge tone={bridge.reconciled ? "success" : "danger"}>{bridge.reconciled ? "Ponte fechada" : "Requer reconciliação"}</StatusBadge>} /><div className={styles.bridgeGrid}>{entries.map((entry) => <div className={styles.bridgeItem} data-tone={entry.tone} key={entry.label}><span>{entry.label}</span><strong>{formatMetric("revenue.closing_mrr", entry.value)}</strong></div>)}</div></Surface>;
}

function ForecastBars({ screen }: Readonly<{ screen: RevenueMetricsScreen }>) {
  const ids = ["forecast.pipeline", "forecast.best_case", "forecast.commit", "forecast.weighted"] as const;
  const items = ids.flatMap((id) => {
    const metric = screen.metrics.find((item) => item.metricId === id);
    const definition = revenueMetricRegistryById.get(id);
    return metric && definition ? [{ id, metric, definition }] : [];
  });
  const maximum = items.reduce((max, item) => item.metric.value !== null && BigInt(item.metric.value) > max ? BigInt(item.metric.value) : max, 0n);
  return <Surface className={styles.forecastPanel}><SectionHeader eyebrow="Cenários independentes" title="Comparação do forecast" description="As faixas mostram cenários separados; os valores não são parcelas de um total." /><div className={styles.forecastRows}>{items.map(({ id, metric, definition }) => { const width = maximum > 0n && metric.value !== null && BigInt(metric.value) > 0n ? Number(BigInt(metric.value) * 100n / maximum) : 0; return <div className={styles.forecastRow} key={id}><div><span>{definition.name}</span><strong>{formatMetric(id, metric.value)}</strong></div><progress max={100} value={width} /><small>{stateLabels[metric.state]}</small></div>; })}</div></Surface>;
}

export function RevenueMetricsWorkspace({ screen, section, drilldown }: Readonly<{ screen: RevenueMetricsScreen; section: string; drilldown: RevenueDrilldownPage | null }>) {
  const query = persistedQuery(screen);
  const filterCount = Object.values(screen.query.filters).reduce((total, values) => total + values.length, 0);
  return <div className={`analytics-canvas ${styles.workspace}`}>
    <section className={styles.hero}><div><span>Indicadores · {screen.scope === "WORKSPACE" ? "Visão geral" : screen.scope === "TEAM" ? "Equipe" : "Meus registros"}</span><h1>Receita e retenção</h1><p>Acompanhe vendas, recorrência e previsão de receita.</p></div><div className={styles.heroMeta}><span>Atualizado</span><strong>{new Date(screen.generatedAt).toLocaleString("pt-BR", { timeZone: screen.query.period.timeZone })}</strong>{filterCount > 0 ? <small>{filterCount} filtros aplicados</small> : null}</div></section>
    <Surface className={styles.filterPanel} tone="subtle">
      <form className={styles.filterForm} method="get">
        <label className="grid gap-1 text-sm font-medium">Período<select name="preset" defaultValue={screen.query.preset}><option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana</option><option value="MONTH">Mês</option><option value="CUSTOM">Personalizado</option></select></label>
        <label className="grid gap-1 text-sm font-medium">Data inicial<input name="fromDate" type="date" defaultValue={screen.query.period.fromDate} /></label>
        <label className="grid gap-1 text-sm font-medium">Data final<input name="toDate" type="date" defaultValue={screen.query.period.toDate} /></label>
        <input name="section" type="hidden" value={section === "drilldown" ? "summary" : section} />
        {Object.entries(filterNames).flatMap(([filter, parameter]) => screen.query.filters[filter as keyof typeof filterNames].map((value) => <input key={`${parameter}:${value}`} name={parameter} type="hidden" value={value} />))}
        <Button size="sm" type="submit">Aplicar período</Button>
        <details className={styles.periodDetails}><summary>Comparação e atualização</summary><div><p>Atual: {screen.query.period.fromDate} a {screen.query.period.toDate}</p><p>Anterior: {screen.query.comparisonPeriod.fromDate} a {screen.query.comparisonPeriod.toDate}</p><p>Corte: {new Date(screen.query.asOf).toLocaleString("pt-BR", { timeZone: screen.query.period.timeZone })}</p></div></details>
      </form>
    </Surface>
    <nav aria-label="Seções das métricas" className={styles.tabs}>{sections.map((item) => <Link aria-current={section === item.id ? "page" : undefined} href={sectionHref(query, item.id)} key={item.id}>{item.label}</Link>)}</nav>
    {!screen.hasData && section !== "catalog" && section !== "drilldown" ? <div className={styles.noData} role="status">Ainda não há fatos financeiros neste recorte. Os indicadores exibem seus estados reais, sem séries fictícias.</div> : null}
    {section === "summary" ? <>
      <MetricCards screen={screen} ids={["sales.bookings", "revenue.closing_mrr", "cash.received", "sales.win_rate"]} />
      <div className={styles.chartGrid}><SeriesPanel description="Valor contratado em cada período." metricId="sales.bookings" screen={screen} title="Bookings" variant="bar" /><SeriesPanel description="Pagamentos confirmados líquidos de reversões." metricId="cash.received" screen={screen} title="Caixa recebido" /></div>
      <MetricCards screen={screen} ids={["revenue.net_new_mrr", "retention.grr", "retention.nrr", "forecast.commit"]} />
      <BridgePanel screen={screen} />
    </> : null}
    {section === "mrr" ? <>
      <MetricCards screen={screen} ids={["revenue.opening_mrr", "revenue.closing_mrr", "revenue.net_new_mrr", "revenue.arr"]} />
      <div className={styles.chartGrid}><SeriesPanel description="Saldo recorrente no fechamento de cada período." metricId="revenue.closing_mrr" screen={screen} title="MRR final" /><SeriesPanel description="Variação da receita recorrente em cada período." metricId="revenue.net_new_mrr" screen={screen} title="Net New MRR" variant="bar" /></div>
      <MetricCards screen={screen} ids={["revenue.new_mrr", "revenue.expansion_mrr", "revenue.reactivation_mrr", "revenue.contraction_mrr", "revenue.churned_mrr"]} />
      <BridgePanel screen={screen} />
    </> : null}
    {section === "retention" ? <><MetricCards screen={screen} ids={["retention.grr", "retention.nrr", "retention.logo_churn", "retention.renewal_rate"]} /><Surface className="p-5"><SectionHeader title="Coortes de ativação" description="A coorte do mês em curso aparece como parcial/censurada." />{screen.cohorts.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Coorte</th><th>Assinaturas</th><th>MRR inicial</th><th>MRR no corte</th><th>Retenção</th><th>Estado</th></tr></thead><tbody>{screen.cohorts.map((row) => <tr key={row.cohort}><td><Link className="link" href={sectionHref(query, "drilldown", row.drilldownId)}>{row.cohort}</Link></td><td>{row.subscriptionCount}</td><td>{formatMetric("revenue.opening_mrr", row.initialMrrCents)}</td><td>{formatMetric("revenue.closing_mrr", row.currentMrrCents)}</td><td>{row.retentionBasisPoints === null ? "—" : `${row.retentionBasisPoints / 100}%`}</td><td><State state={row.state} /></td></tr>)}</tbody></table></DataTableShell> : <EmptyState compact title="Sem coortes" description="Não há assinaturas com ativação no universo autorizado." />}</Surface></> : null}
    {section === "forecast" ? <><MetricCards screen={screen} ids={["forecast.pipeline", "forecast.best_case", "forecast.commit", "forecast.weighted", "forecast.gap"]} /><ForecastBars screen={screen} /><Surface className="p-5" tone="subtle"><SectionHeader title="Corte imutável" description={screen.forecastSnapshot ? `Snapshot ${screen.forecastSnapshot.id} em ${new Date(screen.forecastSnapshot.asOf).toLocaleString("pt-BR")}. Cobertura ${(screen.forecastSnapshot.coverageBasisPoints / 100).toLocaleString("pt-BR")}%.` : "Nenhum snapshot compatível com o período."} /></Surface></> : null}
    {section === "quality" ? <Surface className="p-5"><SectionHeader title="Qualidade e cobertura" description="Problemas de cobertura não são convertidos silenciosamente em zero." /><div className={styles.qualityGrid}>{screen.quality.map((item) => <article className={styles.qualityCard} key={item.id}><div><strong>{item.label}</strong><State state={item.state} /></div><p>{item.detail}</p>{item.coverageBasisPoints !== null ? <progress aria-label={`${item.label}: cobertura`} max={10000} value={item.coverageBasisPoints} /> : null}{item.action ? <small>Ação: {item.action}</small> : null}</article>)}</div></Surface> : null}
    {section === "catalog" ? <Surface className="p-5"><SectionHeader title={`Catálogo ${screen.registryVersion}`} description="Definições únicas, versionadas e reutilizáveis por API e interface." /><DataTableShell className="mt-4"><table><thead><tr><th>Métrica</th><th>Fórmula</th><th>Fonte oficial</th><th>Timestamp</th></tr></thead><tbody>{[...revenueMetricRegistryById.values()].map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.id}@v{item.version}</small></td><td>{item.formula}</td><td>{item.sourceOfTruth.join(" + ")}</td><td>{item.factTimestamp}</td></tr>)}</tbody></table></DataTableShell></Surface> : null}
    {section === "drilldown" && drilldown ? <Surface className="p-5"><SectionHeader title={drilldown.metric.name} description={`${drilldown.metric.formula} · ${drilldown.total} registros`} action={<Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={sectionHref(query, "summary")}>Voltar</Link>} />{drilldown.records.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Registro</th><th>Data</th><th>Contribuição</th><th>Fonte</th></tr></thead><tbody>{drilldown.records.map((item) => <tr key={item.key}><td><Link className="link" href={item.href}>{item.title}</Link><br /><small>{item.subtitle}</small></td><td>{new Date(item.occurredAt).toLocaleString("pt-BR", { timeZone: screen.query.period.timeZone })}</td><td>{item.unit === "CENTS" ? formatMetric(drilldown.metric.id, item.contribution) : item.contribution}</td><td>{item.provenance}</td></tr>)}</tbody></table></DataTableShell> : <EmptyState compact title="Nenhum registro" description="O estado da métrica é válido, mas este recorte não contém fatos individuais." />}</Surface> : null}
  </div>;
}
