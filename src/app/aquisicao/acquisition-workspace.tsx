"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getMarketingAttributionService>["getScreen"]>>;
const date = (value: Date | string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function AcquisitionWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function run(modelKey: string) {
    setPending(true); setFeedback(null);
    const response = await fetch("/api/marketing/attribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RUN", data: { modelKey, periodStart: initial.period.start, periodEnd: initial.period.end, idempotencyKey: `ui-${modelKey}-${initial.period.start}-${initial.period.end}` } }) });
    const body = await response.json(); setPending(false);
    if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível calcular a atribuição."); return; }
    setFeedback(`Modelo ${modelKey} calculado com rastreabilidade.`); router.refresh();
  }

  return <div className="space-y-5">
    <Surface tone="accent"><SectionHeader title="Fundação local e conservadora" description="Touchpoints em revisão jurídica não recebem crédito elegível. Ausência permanece explícita como não atribuída." /><Link className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline" href="/aquisicao/midia">Abrir mídia paga e performance</Link></Surface>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Touchpoints" value={initial.summary.touchpoints} hint="Fatos persistidos no período" />
      <StatCard label="Conversões" value={initial.summary.conversions} hint="Eventos canônicos ativos" />
      <StatCard label="Cobertura" value={initial.summary.latestCoverageBps === null ? "Sem cálculo" : `${(initial.summary.latestCoverageBps / 100).toFixed(1)}%`} hint="Última execução versionada" />
      <StatCard label="Revisões abertas" value={initial.summary.openReviews} hint="Evidência ou privacidade pendente" />
    </div>

    <Surface>
      <SectionHeader title="Modelos de atribuição" description={`Período ${date(initial.period.start)} a ${date(initial.period.end)} · ${initial.period.timeZone}`} />
      <div className="mt-4 grid gap-3 md:grid-cols-3">{initial.models.map((model) => <article className="rounded-[var(--radius-panel)] border border-border bg-[var(--surface-subtle)] p-4" key={model.id}><strong>{model.name}</strong><p className="mt-1 text-sm text-muted-foreground">Versão {model.currentVersion} · {model.status}</p>{initial.permissions.canExecute ? <Button className="mt-3" disabled={pending} onClick={() => run(model.key)} size="sm">Calcular</Button> : null}</article>)}</div>
      {feedback ? <p className="mt-3 text-sm" role="status">{feedback}</p> : null}
    </Surface>

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Surface><SectionHeader title="Execuções recentes" description="Cada execução registra modelo, versão, período, cobertura e ausência." />{initial.runs.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Status</th><th>Conversões</th><th>Cobertura</th><th>Não atribuídas</th><th>Início</th></tr></thead><tbody>{initial.runs.map((run) => <tr key={run.id}><td>{run.status}</td><td>{run.conversionCount}</td><td>{(run.coverageBps / 100).toFixed(1)}%</td><td>{run.unattributedCount}</td><td>{date(run.startedAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma execução no workspace.</p>}</Surface>
      <Surface tone="subtle"><SectionHeader title="Qualidade e revisão" description="Pendências exigem evidência; não são corrigidas automaticamente." />{initial.issues.length ? <div className="mt-4 space-y-2">{initial.issues.slice(0, 12).map((issue) => <article className="rounded-[var(--radius-control)] border border-border bg-card p-3 text-sm" key={issue.id}><div className="flex justify-between gap-2"><strong>{issue.issueCode}</strong><span>{issue.status}</span></div><p className="mt-1 text-muted-foreground">{issue.entityType} · {issue.severity}</p></article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma divergência detectada.</p>}</Surface>
    </div>
    <Surface><SectionHeader title="Volume por origem" description="Contagem factual de touchpoints; não representa causalidade nem custo de mídia." /><DataTableShell className="mt-4"><table><thead><tr><th>Origem</th><th>Touchpoints</th></tr></thead><tbody>{initial.sourceBreakdown.map((row) => <tr key={row.sourceId ?? "unknown"}><td>{row.sourceName}</td><td>{row._count._all}</td></tr>)}</tbody></table></DataTableShell></Surface>
  </div>;
}
