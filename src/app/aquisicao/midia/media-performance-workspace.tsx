"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnalyticsChart } from "../analytics-chart";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import styles from "../acquisition-workspace.module.css";

type Screen = Awaited<ReturnType<ReturnType<typeof getMediaPerformanceService>["getScreen"]>>;
type ChartMetric = "spendCents" | "impressions" | "clicks" | "reportedLeads";
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const metricValue = (amount: number | null, unit: Screen["metrics"][number]["unit"]) => amount === null ? "Sem base" : unit === "BRL_CENTS" ? money(amount) : unit === "BPS" ? `${(amount / 100).toFixed(2)}%` : amount.toLocaleString("pt-BR");
const sample = "date,channelKey,channelName,accountKey,accountName,campaignKey,campaignName,adGroupKey,adGroupName,adKey,adName,creativeKey,creativeName,currency,timeZone,spendCents,impressions,reach,clicks,linkClicks,landingPageViews,reportedLeads,reportedPurchases,reportedRevenueCents";
const chartOptions: readonly { key: ChartMetric; label: string }[] = [{ key: "spendCents", label: "Investimento" }, { key: "impressions", label: "Impressões" }, { key: "clicks", label: "Cliques" }, { key: "reportedLeads", label: "Leads" }];

export function MediaPerformanceWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("spendCents");
  const chartData = initial.trend.map((point) => ({ ...point, value: chartMetric === "spendCents" ? point.spendCents / 100 : point[chartMetric] }));

  async function post(body: unknown) {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch("/api/marketing/performance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Operação não concluída.");
      router.refresh();
      return payload.result;
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Operação não concluída."); return null; }
    finally { setPending(false); }
  }
  async function preview() {
    setPreviewId(null);
    const result = await post({ action: "PREVIEW_IMPORT", data: { fileName: "performance-local.csv", csv, idempotencyKey: `preview-${crypto.randomUUID()}` } });
    if (result) { setPreviewId(result.id); setFeedback(`Prévia: ${result.validCount} linhas válidas e ${result.rejectedCount} rejeitadas.`); }
  }
  async function confirm() {
    if (!previewId) return;
    const result = await post({ action: "CONFIRM_IMPORT", data: { previewRunId: previewId, idempotencyKey: `confirm-${crypto.randomUUID()}` } });
    if (result) { setPreviewId(null); setImportOpen(false); setFeedback(`${result.createdCount} registros importados; ${result.supersededCount} correções registradas.`); }
  }
  async function backfill(mode: "DRY_RUN" | "EXECUTE") {
    const result = await post({ action: "BACKFILL_HIERARCHY", data: { mode, idempotencyKey: `hierarchy-${mode}-${crypto.randomUUID()}` } });
    if (result) setFeedback(`${mode === "DRY_RUN" ? "Prévia" : "Vinculação"}: ${result.candidateCount} candidatos, ${result.createdCount} criados.`);
  }
  async function reconcile() {
    const result = await post({ action: "RECONCILE", data: { periodStart: initial.period.start, periodEnd: initial.period.end, idempotencyKey: `reconcile-${crypto.randomUUID()}` } });
    if (result) setFeedback(`Reconciliação concluída com ${result.issueCount} divergências.`);
  }

  return <div className={styles.workspace}>
    <div className={styles.toolbar}><div><Icon name="agenda" size={15} /><span>{initial.period.start.slice(0, 10)} — {initial.period.end.slice(0, 10)}</span><small>vs. {initial.period.previousStart.slice(0, 10)} — {initial.period.previousEnd.slice(0, 10)}</small></div>{initial.permissions.canImport ? <Button onClick={() => setImportOpen(true)} size="sm"><Icon name="mais" size={14} /> Importar performance</Button> : null}</div>
    {feedback && !importOpen ? <p className={styles.feedback} role="status">{feedback}</p> : null}
    <section aria-label="Resumo de mídia" className={styles.kpis}>{[
      { label: "Investimento", value: money(initial.totals.spendCents), hint: "Total no período", icon: "receita" as const },
      { label: "Impressões", value: initial.totals.impressions.toLocaleString("pt-BR"), hint: "Exibições dos anúncios", icon: "tendencia" as const },
      { label: "Cliques", value: initial.totals.clicks.toLocaleString("pt-BR"), hint: "Interações reportadas", icon: "entrada" as const },
      { label: "Leads reportados", value: initial.totals.reportedLeads.toLocaleString("pt-BR"), hint: "Volume informado pela mídia", icon: "leads" as const },
    ].map((metric) => <article className={styles.stat} key={metric.label}><div><span>{metric.label}</span><Icon name={metric.icon} size={16} /></div><strong>{metric.value}</strong><small>{metric.hint}</small></article>)}</section>

    <div className={styles.primaryGrid}><Surface className={styles.panel}><SectionHeader title="Evolução da performance" description="Compare o comportamento dos seus indicadores ao longo dos dias." /><div aria-label="Indicador do gráfico" className={styles.chartTabs} role="group">{chartOptions.map((option) => <button aria-pressed={chartMetric === option.key} key={option.key} onClick={() => setChartMetric(option.key)} type="button">{option.label}</button>)}</div>{chartData.length ? <AnalyticsChart label={`Evolução diária de ${chartOptions.find((option) => option.key === chartMetric)?.label}`} points={chartData.map((point) => ({ label: point.date.slice(5).split("-").reverse().join("/"), values: { value: point.value } }))} series={[{ key: "value", label: chartOptions.find((option) => option.key === chartMetric)?.label ?? "Indicador", color: "#ff6b2c" }]} formatValue={(value) => chartMetric === "spendCents" ? money(value * 100) : value.toLocaleString("pt-BR")} /> : <div className={styles.chartEmpty}><Icon name="tendencia" size={28} /><strong>Acompanhe a evolução das campanhas</strong><span>Importe os dados de performance para visualizar o gráfico diário.</span></div>}<details className={styles.dataDetails}><summary>Ver dados em tabela</summary><DataTableShell className="mt-3"><table><thead><tr><th>Data</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>Leads</th></tr></thead><tbody>{initial.trend.map((point) => <tr key={point.date}><td>{point.date}</td><td>{money(point.spendCents)}</td><td>{point.impressions}</td><td>{point.clicks}</td><td>{point.reportedLeads}</td></tr>)}</tbody></table></DataTableShell></details></Surface>
    <Surface className={styles.panel}><SectionHeader title="Funil de aquisição" description="Da mídia à jornada comercial no CRM." /><div className={styles.funnelGroups}>{[{ label: "Mídia", stages: initial.funnel.media }, { label: "CRM", stages: initial.funnel.crm }, { label: "Resultados", stages: initial.funnel.outcomes }].map((group) => { const max = Math.max(...group.stages.map((stage) => stage.value), 1); return <section key={group.label}><h3>{group.label}</h3>{group.stages.map((stage) => <div className={styles.funnelRow} key={stage.key}><div><span>{stage.label}</span><strong>{stage.value.toLocaleString("pt-BR")}</strong></div><progress aria-label={`${stage.label}: ${stage.value}`} max={max} value={stage.value} /></div>)}</section>; })}</div></Surface></div>

    <Surface className={styles.panel}><SectionHeader title="Eficiência das campanhas" description="Resultados atuais e comparação com o período anterior." /><DataTableShell className="mt-4"><table><thead><tr><th>Métrica</th><th>Atual</th><th>Anterior</th><th>Base de cálculo</th></tr></thead><tbody>{initial.metrics.map((metric) => <tr key={metric.key}><td>{metric.label}</td><td><strong>{metricValue(metric.value, metric.unit)}</strong></td><td>{metricValue(metric.previousValue, metric.unit)}</td><td>{metric.denominator === 0 ? "Sem base" : `${metric.numerator} / ${metric.denominator}`}</td></tr>)}</tbody></table></DataTableShell></Surface>
    <div className={styles.secondaryGrid}><Surface className={styles.panel}><SectionHeader title="Histórico de importações" description="Arquivos processados e resultado de cada execução." />{initial.runs.length ? <div className={styles.importRuns}>{initial.runs.map((run) => <article key={run.id}><span className={styles.modelIcon}><Icon name="entrada" size={16} /></span><div><strong>{run.sourceFileName}</strong><small>{run.mode}</small></div><span>{run.status}</span></article>)}</div> : <p className={styles.emptyNote}>Nenhuma importação executada.</p>}</Surface><Surface className={styles.panel}><SectionHeader title="Reconciliação" description="Compare os dados da mídia com os registros do CRM." />{initial.issues.length ? <div className={styles.issueList}>{initial.issues.map((issue) => <article key={issue.id}><Icon name="alerta" size={16} /><strong>{issue.issueCode}</strong></article>)}</div> : <div className={styles.healthy}><Icon name="auditoria" size={22} /><strong>Nenhuma divergência registrada</strong></div>}{initial.permissions.canReconcile ? <Button disabled={pending} onClick={reconcile} size="sm" variant="secondary">Reconciliar mídia e CRM</Button> : null}</Surface></div>
    {initial.permissions.canImport ? <details className={styles.dataDetails}><summary>Manutenção da hierarquia de campanhas</summary><p className={styles.footnote}>Revise os vínculos de campanhas, anúncios e criativos de importações anteriores.</p><div className={styles.actions}><Button disabled={pending} onClick={() => backfill("DRY_RUN")} size="sm" variant="secondary">Consultar vínculos pendentes</Button><Button disabled={pending} onClick={() => backfill("EXECUTE")} size="sm" variant="secondary">Vincular registros por ID</Button></div></details> : null}
    {importOpen ? <AccessibleDialog busy={pending} className={styles.importDialog!} labelledBy="media-import-title" onDismiss={() => setImportOpen(false)}><div className={styles.dialogHeader}><div><span>Importação de dados</span><h2 id="media-import-title">Adicionar performance</h2></div><button aria-label="Fechar importação" disabled={pending} onClick={() => setImportOpen(false)} type="button">×</button></div><p className={styles.footnote}>Cole seu CSV de até 512 KiB e 2.000 linhas. Gere uma prévia e confira o resultado antes de confirmar.</p><label className={styles.csvLabel}>Dados em CSV<textarea disabled={pending} onChange={(event) => { setCsv(event.target.value); setPreviewId(null); setFeedback(null); }} placeholder={sample} rows={10} value={csv} /></label>{feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}<div className={styles.actions}><Button disabled={pending || !csv.trim()} onClick={preview} variant="secondary">Gerar prévia</Button><Button disabled={pending || !previewId} onClick={confirm}>Confirmar importação</Button></div></AccessibleDialog> : null}
  </div>;
}
