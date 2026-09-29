import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, StatCard, Surface, DataTableShell } from "@/components/ui/surface";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { RevenueDrilldownPage, RevenueMetricState, RevenueMetricsScreen } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueMetricRegistryById } from "@/modules/metrics/domain/revenue-metric-registry";
import { cn } from "@/shared/core/ui/class-names";

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
  if (definition?.unit === "CENTS") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
  if (definition?.unit === "BASIS_POINTS") return `${(Number(value) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
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
  const comparison = new Map(screen.comparisons.map((item) => [item.metricId, item]));
  const query = persistedQuery(screen);
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{ids.map((id) => { const item = byId.get(id); const definition = revenueMetricRegistryById.get(id); const trend = comparison.get(id); if (!item || !definition) return null; return <Link href={sectionHref(query, "drilldown", id)} key={id} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><StatCard label={definition.name} value={formatMetric(id, item.value)} hint={`${stateLabels[item.state]} · ${trend?.direction === "UP" ? "↑" : trend?.direction === "DOWN" ? "↓" : "→"} período anterior`} tone={item.state === "AVAILABLE" ? "info" : item.state === "PARTIAL" || item.state === "NO_DENOMINATOR" ? "warning" : "default"} /></Link>; })}</div>;
}

function State({ state }: Readonly<{ state: RevenueMetricState }>) { return <StatusBadge tone={stateTones[state]}>{stateLabels[state]}</StatusBadge>; }

export function RevenueMetricsWorkspace({ screen, section, drilldown }: Readonly<{ screen: RevenueMetricsScreen; section: string; drilldown: RevenueDrilldownPage | null }>) {
  const query = persistedQuery(screen);
  return <div className="space-y-5">
    <Surface className="p-4" tone="subtle">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="grid gap-1 text-sm font-medium">Período<select name="preset" defaultValue={screen.query.preset}><option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana</option><option value="MONTH">Mês</option><option value="CUSTOM">Personalizado</option></select></label>
        <label className="grid gap-1 text-sm font-medium">Data inicial<input name="fromDate" type="date" defaultValue={screen.query.period.fromDate} /></label>
        <label className="grid gap-1 text-sm font-medium">Data final<input name="toDate" type="date" defaultValue={screen.query.period.toDate} /></label>
        <input name="section" type="hidden" value={section === "drilldown" ? "summary" : section} />
        {Object.entries(filterNames).flatMap(([filter, parameter]) => screen.query.filters[filter as keyof typeof filterNames].map((value) => <input key={`${parameter}:${value}`} name={parameter} type="hidden" value={value} />))}
        <Button type="submit">Aplicar período</Button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">Atual: {screen.query.period.fromDate} a {screen.query.period.toDate} · comparação: {screen.query.comparisonPeriod.fromDate} a {screen.query.comparisonPeriod.toDate} · corte {new Date(screen.query.asOf).toLocaleString("pt-BR", { timeZone: screen.query.period.timeZone })}</p>
    </Surface>
    <nav aria-label="Seções das métricas" className="flex flex-wrap gap-2">{sections.map((item) => <Link aria-current={section === item.id ? "page" : undefined} className={cn(buttonVariants({ variant: section === item.id ? "default" : "secondary", size: "sm" }))} href={sectionHref(query, item.id)} key={item.id}>{item.label}</Link>)}</nav>
    {section === "summary" ? <><MetricCards screen={screen} ids={["sales.bookings", "revenue.closing_mrr", "cash.received", "sales.win_rate", "revenue.net_new_mrr", "retention.grr", "retention.nrr", "forecast.commit"]} /><Surface className="p-5" tone="accent"><SectionHeader eyebrow="Ponte reconciliada" title="Movimentação do MRR" description="O saldo inicial mais movimentos deve fechar exatamente no saldo final." /><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="MRR inicial" value={formatMetric("revenue.opening_mrr", screen.bridge.openingMrrCents)} /><StatCard label="New + expansão" value={formatMetric("revenue.new_mrr", (BigInt(screen.bridge.newMrrCents) + BigInt(screen.bridge.expansionMrrCents)).toString())} tone="success" /><StatCard label="Contração + churn" value={formatMetric("revenue.churned_mrr", (BigInt(screen.bridge.contractionMrrCents) + BigInt(screen.bridge.churnMrrCents)).toString())} tone="danger" /><StatCard label="MRR final" value={formatMetric("revenue.closing_mrr", screen.bridge.closingMrrCents)} hint={screen.bridge.reconciled ? "Ponte fechada" : "Requer reconciliação"} tone={screen.bridge.reconciled ? "success" : "danger"} /></div></Surface></> : null}
    {section === "mrr" ? <><MetricCards screen={screen} ids={["revenue.opening_mrr", "revenue.new_mrr", "revenue.expansion_mrr", "revenue.reactivation_mrr", "revenue.contraction_mrr", "revenue.churned_mrr", "revenue.net_new_mrr", "revenue.closing_mrr", "revenue.arr"]} /><Surface className="p-5"><SectionHeader title="Série do MRR" description="Buckets civis reais; zero significa bucket existente sem movimento." /><DataTableShell className="mt-4"><table><thead><tr><th>Bucket</th><th>MRR final</th><th>Net New MRR</th></tr></thead><tbody>{screen.series.find((item) => item.metricId === "revenue.closing_mrr")?.points.map((point, index) => <tr key={point.bucket}><td>{point.bucket}</td><td>{formatMetric("revenue.closing_mrr", point.value)}</td><td>{formatMetric("revenue.net_new_mrr", screen.series.find((item) => item.metricId === "revenue.net_new_mrr")?.points[index]?.value ?? null)}</td></tr>)}</tbody></table></DataTableShell></Surface></> : null}
    {section === "retention" ? <><MetricCards screen={screen} ids={["retention.grr", "retention.nrr", "retention.logo_churn", "retention.renewal_rate"]} /><Surface className="p-5"><SectionHeader title="Coortes de ativação" description="A coorte do mês em curso aparece como parcial/censurada." />{screen.cohorts.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Coorte</th><th>Assinaturas</th><th>MRR inicial</th><th>MRR no corte</th><th>Retenção</th><th>Estado</th></tr></thead><tbody>{screen.cohorts.map((row) => <tr key={row.cohort}><td><Link className="link" href={sectionHref(query, "drilldown", row.drilldownId)}>{row.cohort}</Link></td><td>{row.subscriptionCount}</td><td>{formatMetric("revenue.opening_mrr", row.initialMrrCents)}</td><td>{formatMetric("revenue.closing_mrr", row.currentMrrCents)}</td><td>{row.retentionBasisPoints === null ? "—" : `${row.retentionBasisPoints / 100}%`}</td><td><State state={row.state} /></td></tr>)}</tbody></table></DataTableShell> : <EmptyState compact title="Sem coortes" description="Não há assinaturas com ativação no universo autorizado." />}</Surface></> : null}
    {section === "forecast" ? <><MetricCards screen={screen} ids={["forecast.pipeline", "forecast.best_case", "forecast.commit", "forecast.weighted", "forecast.gap"]} /><Surface className="p-5" tone="subtle"><SectionHeader title="Corte imutável" description={screen.forecastSnapshot ? `Snapshot ${screen.forecastSnapshot.id} em ${new Date(screen.forecastSnapshot.asOf).toLocaleString("pt-BR")}.` : "Nenhum snapshot compatível com o período."} /></Surface></> : null}
    {section === "quality" ? <Surface className="p-5"><SectionHeader title="Qualidade e cobertura" description="Problemas de cobertura não são convertidos silenciosamente em zero." /><div className="mt-4 grid gap-3">{screen.quality.map((item) => <div className="rounded-xl border bg-white p-4" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.label}</strong><State state={item.state} /></div><p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>{item.action ? <p className="mt-2 text-sm font-semibold">Ação: {item.action}</p> : null}</div>)}</div></Surface> : null}
    {section === "catalog" ? <Surface className="p-5"><SectionHeader title={`Catálogo ${screen.registryVersion}`} description="Definições únicas, versionadas e reutilizáveis por API e interface." /><DataTableShell className="mt-4"><table><thead><tr><th>Métrica</th><th>Fórmula</th><th>Fonte oficial</th><th>Timestamp</th></tr></thead><tbody>{[...revenueMetricRegistryById.values()].map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.id}@v{item.version}</small></td><td>{item.formula}</td><td>{item.sourceOfTruth.join(" + ")}</td><td>{item.factTimestamp}</td></tr>)}</tbody></table></DataTableShell></Surface> : null}
    {section === "drilldown" && drilldown ? <Surface className="p-5"><SectionHeader title={drilldown.metric.name} description={`${drilldown.metric.formula} · ${drilldown.total} registros`} action={<Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={sectionHref(query, "summary")}>Voltar</Link>} />{drilldown.records.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Registro</th><th>Data</th><th>Contribuição</th><th>Fonte</th></tr></thead><tbody>{drilldown.records.map((item) => <tr key={item.key}><td><Link className="link" href={item.href}>{item.title}</Link><br /><small>{item.subtitle}</small></td><td>{new Date(item.occurredAt).toLocaleString("pt-BR", { timeZone: screen.query.period.timeZone })}</td><td>{item.unit === "CENTS" ? formatMetric(drilldown.metric.id, item.contribution) : item.contribution}</td><td>{item.provenance}</td></tr>)}</tbody></table></DataTableShell> : <EmptyState compact title="Nenhum registro" description="O estado da métrica é válido, mas este recorte não contém fatos individuais." />}</Surface> : null}
  </div>;
}
