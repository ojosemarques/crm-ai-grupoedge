"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import styles from "./acquisition-workspace.module.css";

type Screen = Awaited<ReturnType<ReturnType<typeof getMarketingAttributionService>["getScreen"]>>;
const date = (value: Date | string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const colors = ["#f29b5f", "#61b9e8", "#9366e4", "#ed87bc", "#58c3a0", "#e6c164"];

export function AcquisitionWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const sources = initial.sourceBreakdown.map((source) => ({ id: source.sourceId ?? "unknown", name: source.sourceName, value: source._count._all }));
  const sourceTotal = sources.reduce((total, source) => total + source.value, 0);

  async function run(modelKey: string) {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch("/api/marketing/attribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RUN", data: { modelKey, periodStart: initial.period.start, periodEnd: initial.period.end, idempotencyKey: `ui-${modelKey}-${initial.period.start}-${initial.period.end}` } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível calcular a atribuição.");
      setFeedback("Atribuição calculada. Os indicadores foram atualizados.");
      router.refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível calcular a atribuição."); }
    finally { setPending(false); }
  }

  return <div className={styles.workspace}>
    <div className={styles.toolbar}><div><Icon name="agenda" size={15} /><span>{date(initial.period.start)} — {date(initial.period.end)}</span></div><Button asChild size="sm" variant="secondary"><Link href="/aquisicao/midia">Mídia e performance <Icon name="seta-direita" size={14} /></Link></Button></div>
    <section aria-label="Resumo de aquisição" className={styles.kpis}>{[
      { label: "Pontos de contato", value: initial.summary.touchpoints.toLocaleString("pt-BR"), hint: "Interações registradas no período", icon: "leads" as const },
      { label: "Conversões", value: initial.summary.conversions.toLocaleString("pt-BR"), hint: "Eventos de conversão ativos", icon: "tendencia" as const },
      { label: "Cobertura de atribuição", value: initial.summary.latestCoverageBps === null ? "—" : `${(initial.summary.latestCoverageBps / 100).toFixed(1)}%`, hint: initial.summary.latestCoverageBps === null ? "Execute um modelo para calcular" : "Conversões com atribuição calculada", icon: "pipeline" as const },
      { label: "Revisões abertas", value: initial.summary.openReviews.toLocaleString("pt-BR"), hint: "Pendências de evidência ou privacidade", icon: "alerta" as const },
    ].map((metric) => <article className={styles.stat} key={metric.label}><div><span>{metric.label}</span><Icon name={metric.icon} size={16} /></div><strong>{metric.value}</strong><small>{metric.hint}</small></article>)}</section>

    <div className={styles.primaryGrid}>
      <Surface className={styles.panel}><SectionHeader title="De onde vêm os contatos" description="Participação de cada origem nas interações registradas." />{sourceTotal > 0 ? <div className={styles.sourceOverview}><div className={styles.donut} role="img" aria-label={`Distribuição de ${sourceTotal} pontos de contato por origem`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sources} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="90%" paddingAngle={2} stroke="none" isAnimationActive={false}>{sources.map((source, index) => <Cell fill={colors[index % colors.length]!} key={source.id} />)}</Pie><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9 }} /></PieChart></ResponsiveContainer><div className={styles.donutCenter}><span>Total</span><strong>{sourceTotal.toLocaleString("pt-BR")}</strong><small>interações</small></div></div><div className={styles.sourceList}>{sources.slice(0, 6).map((source, index) => <div className={styles.sourceRow} key={source.id}><div><i aria-hidden="true" data-palette={index % colors.length} /><span>{source.name}</span><strong>{(source.value / sourceTotal * 100).toFixed(1)}%</strong></div><progress aria-label={`${source.name}: ${source.value} interações`} max={sourceTotal} value={source.value} /><small>{source.value.toLocaleString("pt-BR")} interações</small></div>)}</div></div> : <div className={styles.chartEmpty}><Icon name="pipeline" size={28} /><strong>Suas origens aparecerão aqui</strong><span>As interações registradas no CRM preenchem a distribuição automaticamente.</span></div>}<details className={styles.dataDetails}><summary>Ver todas as origens</summary><DataTableShell className="mt-3"><table><thead><tr><th>Origem</th><th>Interações</th></tr></thead><tbody>{sources.map((source) => <tr key={source.id}><td>{source.name}</td><td>{source.value.toLocaleString("pt-BR")}</td></tr>)}</tbody></table></DataTableShell></details></Surface>
      <Surface className={styles.panel}><SectionHeader title="Modelos de atribuição" description="Escolha como distribuir o crédito das conversões." /><div className={styles.modelList}>{initial.models.map((model, index) => <article className={styles.model} key={model.id}><span className={styles.modelIcon}><Icon name={index % 2 === 0 ? "pipeline" : "tendencia"} size={17} /></span><div><strong>{model.name}</strong><small>Versão {model.currentVersion} · {model.status}</small></div>{initial.permissions.canExecute ? <Button disabled={pending} onClick={() => run(model.key)} size="sm" variant="secondary">Calcular</Button> : null}</article>)}</div><p className={styles.footnote}>Conversões sem evidência elegível permanecem sem atribuição.</p>{feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}</Surface>
    </div>

    <div className={styles.secondaryGrid}><Surface className={styles.panel}><SectionHeader title="Cálculos recentes" description="Acompanhe a cobertura e as conversões não atribuídas." />{initial.runs.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Status</th><th>Conversões</th><th>Cobertura</th><th>Sem atribuição</th><th>Calculado em</th></tr></thead><tbody>{initial.runs.map((run) => <tr key={run.id}><td>{run.status}</td><td>{run.conversionCount}</td><td>{(run.coverageBps / 100).toFixed(1)}%</td><td>{run.unattributedCount}</td><td>{date(run.startedAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className={styles.emptyNote}>Calcule um modelo para acompanhar os resultados.</p>}</Surface><Surface className={styles.panel}><SectionHeader title="Qualidade dos dados" description="Pendências que precisam da sua atenção." />{initial.issues.length ? <div className={styles.issueList}>{initial.issues.slice(0, 12).map((issue) => <article key={issue.id}><Icon name="alerta" size={16} /><div><strong>{issue.issueCode}</strong><small>{issue.entityType} · {issue.severity}</small></div><span>{issue.status}</span></article>)}</div> : <div className={styles.healthy}><Icon name="auditoria" size={22} /><strong>Nenhuma divergência detectada</strong><span>As revisões abertas aparecerão neste painel.</span></div>}</Surface></div>
  </div>;
}
