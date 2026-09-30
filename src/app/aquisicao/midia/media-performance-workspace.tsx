"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnalyticsChart } from "../analytics-chart";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import type { MediaBreakdownDimension } from "@/modules/marketing/domain/media-breakdown";
import type { FunnelDimension } from "@/modules/marketing/domain/acquisition-funnel";
import styles from "../acquisition-workspace.module.css";
import funnelStyles from "./strategy-funnel.module.css";

type Screen = Awaited<ReturnType<ReturnType<typeof getMediaPerformanceService>["getScreen"]>>;
type ChartMetric = "spendCents" | "impressions" | "clicks" | "reportedLeads";
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
function receiptMoney(cents: string) {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "−" : ""}R$ ${new Intl.NumberFormat("pt-BR").format(absolute / 100n)},${(absolute % 100n).toString().padStart(2, "0")}`;
}
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
  const [mediaDimension, setMediaDimension] = useState<MediaBreakdownDimension>("campaign");
  const [funnelDimension, setFunnelDimension] = useState<FunnelDimension>("source");
  const [strategyKey, setStrategyKey] = useState("");
  const [reviewIssueId, setReviewIssueId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const chartData = initial.trend.map((point) => ({ ...point, value: chartMetric === "spendCents" ? point.spendCents / 100 : point[chartMetric] }));
  const strategies = initial.acquisitionFunnel.byDimension[funnelDimension];
  const strategy = strategies.find((row) => row.key === strategyKey) ?? strategies[0];
  const cohortRate = (value: number, total: number) => total > 0 ? `${(value * 100 / total).toFixed(1)}%` : "Sem base";

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
  async function reviewIssue(status: "ACKNOWLEDGED" | "RESOLVED") {
    const result = await post({ action: "REVIEW_ISSUE", data: { issueId: reviewIssueId, status, reason: reviewReason } });
    if (result) { setReviewIssueId(null); setReviewReason(""); setFeedback(status === "RESOLVED" ? "Divergência resolvida com revisão registrada." : "Divergência marcada como em revisão."); }
  }

  return <div className={styles.workspace}>
    <form action="/aquisicao/midia" className={styles.toolbar}>
      <label>De <input aria-label="Data inicial" type="date" name="periodStart" defaultValue={initial.period.startDate} required /></label>
      <label>Até <input aria-label="Data final inclusiva" type="date" name="periodEnd" defaultValue={initial.period.endDate} required /></label>
      <Button type="submit" size="sm" variant="secondary">Aplicar período</Button>
    </form>
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

    <Surface className={styles.panel}>
      <SectionHeader title="Anúncios por origem" description="Investimento e eficiência de cada canal, campanha ou criativo. Moedas são mantidas separadas." />
      <div className={styles.chartTabs} role="group" aria-label="Agrupar mídia por">{([{ key: "channel", label: "Canal" }, { key: "campaign", label: "Campanha" }, { key: "creative", label: "Criativo" }] as const).map((item) => <button type="button" key={item.key} aria-pressed={mediaDimension === item.key} onClick={() => setMediaDimension(item.key)}>{item.label}</button>)}</div>
      <DataTableShell className="mt-4"><table><thead><tr><th>Origem</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>Leads reportados</th><th>CPM</th><th>CTR</th><th>CPC</th><th>CPL</th><th>Views 3s</th><th>Hook Rate</th></tr></thead><tbody>{initial.mediaBreakdown[mediaDimension].map((row) => {
        const amount = (value: number | null) => value === null ? "Sem base" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: row.currency }).format(value / 100);
        return <tr key={row.key}><td>{row.label}</td><td>{amount(row.spendCents)}</td><td>{row.impressions}</td><td>{row.clicks}</td><td>{row.reportedLeads ?? "Não fornecido"}</td><td>{amount(row.cpmCents)}</td><td>{row.ctrBps === null ? "Sem base" : `${(row.ctrBps / 100).toFixed(2)}%`}</td><td>{amount(row.cpcCents)}</td><td>{amount(row.cplCents)}</td><td>{row.videoViews3s ?? "Não fornecido"}</td><td>{row.hookRateBps === null ? "Sem base" : <><strong>{(row.hookRateBps / 100).toFixed(2)}%</strong><br /><small>{row.hookImpressions.toLocaleString("pt-BR")} impressões · cobertura {row.hookCoverageBps === null ? "não disponível" : `${(row.hookCoverageBps / 100).toFixed(1)}%`}</small></>}</td></tr>;
      })}{!initial.mediaBreakdown[mediaDimension].length ? <tr><td colSpan={11}>Importe ou sincronize a performance nas integrações de anúncios.</td></tr> : null}</tbody></table></DataTableShell>
      <p className={styles.footnote}>Hook Rate = visualizações de 3s ÷ impressões dos mesmos anúncios/dias com vídeo informado. Fonte: Meta Ads actions.video_view; a cobertura mostra quanto das impressões totais possui essa métrica. Ausência não é zero. Leads e CPL ficam sem base quando o provedor não informa leads.</p>
    </Surface>

    <Surface className={styles.panel}>
      <SectionHeader title="Páginas e criativos" description="Visitas consentidas, tempo visível e cliques em elementos identificados, por UTM." />
      <DataTableShell className="mt-4"><table><thead><tr><th>Página</th><th>UTM campanha</th><th>UTM criativo</th><th>Visitas</th><th>Sessões</th><th>Tempo médio visível</th><th>Cliques por elemento</th></tr></thead><tbody>{initial.pageAnalytics.rows.map((row) => <tr key={row.key}><td>{row.page}</td><td>{row.utmCampaign ?? "Não informado"}</td><td>{row.utmContent ?? "Não informado"}</td><td>{row.views}</td><td>{row.sessions}</td><td>{row.averageActiveSeconds === null ? "Sem base" : `${row.averageActiveSeconds}s`}</td><td>{row.clicks.map((click) => `${click.target}: ${click.count}`).join(" · ") || "Nenhum"}</td></tr>)}{!initial.pageAnalytics.rows.length ? <tr><td colSpan={7}>Coleta ainda sem eventos. Instale o script e o relay autenticado nas páginas da empresa.</td></tr> : null}</tbody></table></DataTableShell>
      {initial.pageAnalytics.truncated ? <p role="status">Resultado parcial: exibindo os primeiros 50.000 eventos. Reduza o período para obter todos os eventos.</p> : null}
      <p className={styles.footnote}>A coleta inicia após consentimento explícito. Tempo visível não comprova atenção; não são capturados textos de elementos, campos de formulário nem URLs de navegação.</p>
    </Surface>

    <Surface className={styles.panel}>
      <SectionHeader title="Origem dos resultados comerciais" description={`${initial.acquisitionFunnel.cohortSize} leads criados no período, acompanhados até ${initial.period.end.slice(0, 10)}.`} />
      <div className={styles.chartTabs} role="group" aria-label="Agrupar funil por">
        {([{ key: "source", label: "Canal" }, { key: "campaign", label: "Campanha" }, { key: "creative", label: "Criativo" }, { key: "utmCampaign", label: "UTM campanha" }, { key: "utmContent", label: "UTM criativo" }] as const).map((item) => <button key={item.key} type="button" aria-pressed={funnelDimension === item.key} onClick={() => setFunnelDimension(item.key)}>{item.label}</button>)}
      </div>
      {strategy ? <section aria-label="Workflow da estratégia selecionada">
        <label className={funnelStyles.selector}>Estratégia pela dimensão selecionada <select value={strategy.key} onChange={(event) => setStrategyKey(event.target.value)}>{strategies.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
        <ol className={funnelStyles.flow}>
          {[{ label: "Leads recebidos", value: strategy.leads }, { label: "Agendaram reunião", value: strategy.scheduled }, { label: "Realizaram reunião", value: strategy.completed }, { label: "Compradores", value: strategy.buyers }].map((stage) => <li className={funnelStyles.stage} key={stage.label}><span>{stage.label}</span><strong>{stage.value}</strong><small>{cohortRate(stage.value, strategy.leads)} dos leads da estratégia</small></li>)}
        </ol>
        <div className={funnelStyles.branch}><span>↳ No-show registrado</span><strong>{strategy.noShow}</strong><small>{cohortRate(strategy.noShow, strategy.scheduled)} dos leads que agendaram</small></div>
        <p className={styles.footnote}>A mesma pessoa pode ter no-show e depois realizar reunião. Compradores são leads com venda ganha, mesmo quando não houve reunião registrada. As setas mostram a jornada esperada, sem inferir etapas ausentes.</p>
      </section> : null}
      <DataTableShell className="mt-4"><table><thead><tr><th>Origem</th><th>Chegaram</th><th>Agendaram</th><th>No-show</th><th>Reunião realizada</th><th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Sem tier</th><th>Representantes</th><th>Compradores</th><th>Vendas</th><th>Vendas contratadas</th><th>Recebido bruto</th><th>Estornos no período</th><th>Recebido líquido</th></tr></thead><tbody>
        {initial.acquisitionFunnel.byDimension[funnelDimension].map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.leads}</td><td>{row.scheduled}</td><td>{row.noShow}</td><td>{row.completed}</td><td>{row.tier1}</td><td>{row.tier2}</td><td>{row.tier3}</td><td>{row.unclassified}</td><td>{row.representatives}</td><td>{row.buyers}</td><td>{row.sales}</td><td>{money(row.revenueCents)}</td><td>{receiptMoney(row.receivedCents)}</td><td>{receiptMoney(row.reversedCents)}</td><td>{receiptMoney(row.netReceivedCents)}</td></tr>)}
        {!initial.acquisitionFunnel.cohortSize ? <tr><td colSpan={16}>Nenhum lead recebido no período.</td></tr> : null}
      </tbody></table></DataTableShell>
      {initial.acquisitionFunnel.truncated ? <p role="status">Resultado parcial: limite de 10.000 leads, 50.000 eventos de atribuição ou 50.000 pagamentos atingido. Reduza o período para analisar a coorte completa.</p> : null}
      {initial.acquisitionFunnel.excludedReceiptCount ? <p role="status">{initial.acquisitionFunnel.excludedReceiptCount} pagamento(s) excluído(s) por moeda incompatível ou reversão sem data. Revise os registros em Pagamentos.</p> : null}
      <p className={styles.footnote}>{initial.acquisitionFunnel.method}</p><p className={styles.footnote}>{initial.acquisitionFunnel.classification}</p>
      <p className={styles.footnote}>{initial.acquisitionFunnel.receiptMethod}</p>
    </Surface>

    <Surface className={styles.panel}><SectionHeader title="Eficiência das campanhas" description="Resultados atuais e comparação com o período anterior." /><DataTableShell className="mt-4"><table><thead><tr><th>Métrica</th><th>Atual</th><th>Anterior</th><th>Base de cálculo</th></tr></thead><tbody>{initial.metrics.map((metric) => <tr key={metric.key}><td>{metric.label}</td><td><strong>{metricValue(metric.value, metric.unit)}</strong></td><td>{metricValue(metric.previousValue, metric.unit)}</td><td>{metric.denominator === 0 ? "Sem base" : `${metric.numerator} / ${metric.denominator}`}</td></tr>)}</tbody></table></DataTableShell></Surface>
    <div className={styles.secondaryGrid}><Surface className={styles.panel}><SectionHeader title="Histórico de importações" description="Arquivos processados e resultado de cada execução." />{initial.runs.length ? <div className={styles.importRuns}>{initial.runs.map((run) => <article key={run.id}><span className={styles.modelIcon}><Icon name="entrada" size={16} /></span><div><strong>{run.sourceFileName}</strong><small>{run.mode}</small></div><span>{run.status}</span></article>)}</div> : <p className={styles.emptyNote}>Nenhuma importação executada.</p>}</Surface><Surface className={styles.panel}><SectionHeader title="Reconciliação" description="O worker audita o dia anterior uma vez por dia. Divergências aguardam revisão humana." />{initial.issues.length ? <div className={styles.issueList}>{initial.issues.map((issue) => <article key={issue.id}><Icon name="alerta" size={16} /><div><strong>{issue.issueCode === "MEDIA_CRM_LEAD_DIVERGENCE" ? "Leads da mídia divergem do CRM" : issue.issueCode}</strong><p>Mídia: {issue.mediaValue} · CRM: {issue.crmValue} · Diferença: {issue.absoluteDifference}</p><small>{issue.status === "ACKNOWLEDGED" ? "Em revisão humana" : "Revisão pendente"}</small>{initial.permissions.canReconcile ? <Button disabled={pending} size="sm" variant="secondary" onClick={() => { setReviewIssueId(issue.id); setReviewReason(""); }}>Revisar</Button> : null}</div></article>)}</div> : <div className={styles.healthy}><Icon name="auditoria" size={22} /><strong>Nenhuma divergência registrada</strong></div>}{initial.permissions.canReconcile ? <Button disabled={pending} onClick={reconcile} size="sm" variant="secondary">Reconciliar mídia e CRM</Button> : null}</Surface></div>
    {initial.permissions.canImport ? <details className={styles.dataDetails}><summary>Manutenção da hierarquia de campanhas</summary><p className={styles.footnote}>Revise os vínculos de campanhas, anúncios e criativos de importações anteriores.</p><div className={styles.actions}><Button disabled={pending} onClick={() => backfill("DRY_RUN")} size="sm" variant="secondary">Consultar vínculos pendentes</Button><Button disabled={pending} onClick={() => backfill("EXECUTE")} size="sm" variant="secondary">Vincular registros por ID</Button></div></details> : null}
    {reviewIssueId ? <AccessibleDialog busy={pending} className={styles.importDialog!} labelledBy="media-review-title" onDismiss={() => setReviewIssueId(null)}>
      <div className={styles.dialogHeader}><h2 id="media-review-title">Revisar divergência</h2><button aria-label="Fechar revisão" disabled={pending} onClick={() => setReviewIssueId(null)} type="button">×</button></div>
      <p className={styles.footnote}>Registre a análise e a ação tomada. A revisão fica na auditoria e não altera dados de vendas.</p>
      <label className={styles.csvLabel}>Análise<textarea value={reviewReason} maxLength={500} rows={4} onChange={(event) => setReviewReason(event.target.value)} /></label>
      {feedback ? <p role="status">{feedback}</p> : null}
      <div className={styles.actions}><Button disabled={pending || reviewReason.trim().length < 3} onClick={() => reviewIssue("ACKNOWLEDGED")} variant="secondary">Marcar em revisão</Button><Button disabled={pending || reviewReason.trim().length < 3} onClick={() => reviewIssue("RESOLVED")}>Resolver divergência</Button></div>
    </AccessibleDialog> : null}
    {importOpen ? <AccessibleDialog busy={pending} className={styles.importDialog!} labelledBy="media-import-title" onDismiss={() => setImportOpen(false)}><div className={styles.dialogHeader}><div><span>Importação de dados</span><h2 id="media-import-title">Adicionar performance</h2></div><button aria-label="Fechar importação" disabled={pending} onClick={() => setImportOpen(false)} type="button">×</button></div><p className={styles.footnote}>Cole seu CSV de até 512 KiB e 2.000 linhas. Gere uma prévia e confira o resultado antes de confirmar.</p><label className={styles.csvLabel}>Dados em CSV<textarea disabled={pending} onChange={(event) => { setCsv(event.target.value); setPreviewId(null); setFeedback(null); }} placeholder={sample} rows={10} value={csv} /></label>{feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}<div className={styles.actions}><Button disabled={pending || !csv.trim()} onClick={preview} variant="secondary">Gerar prévia</Button><Button disabled={pending || !previewId} onClick={confirm}>Confirmar importação</Button></div></AccessibleDialog> : null}
  </div>;
}
