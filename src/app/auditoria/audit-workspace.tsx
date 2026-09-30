"use client";

import styles from "@/app/administracao/administration.module.css";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import {
  actorTypes,
  auditOrigins,
  processViolationLabels,
  processViolationSeverities,
  processViolationStatuses,
  processViolationTypes,
  type AuditScreen,
} from "@/modules/audit/domain/audit-contracts";

const actorLabels: Record<string, string> = { HUMAN: "Humano", SYSTEM: "Sistema", AUTOMATION: "Automação", AI_AGENT: "Agente de IA" };
const originLabels: Record<string, string> = { API: "API/interface", DOMAIN: "Serviço de domínio", SYSTEM: "Sistema", AUTOMATION: "Automação", AI: "IA", SEED: "Seed local" };
const statusLabels: Record<string, string> = { OPEN: "Aberto", ACKNOWLEDGED: "Reconhecido", RESOLVED: "Resolvido" };
const severityLabels: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };
const selectClass = "mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm";

function apiError(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error && typeof error === "object" && "message" in error) return String(error.message);
  }
  return "Não foi possível concluir a ação.";
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone }).format(new Date(value));
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function pageHref(screen: AuditScreen, kind: "audit" | "violation", page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(screen.filters)) {
    if (value === "" || key === "auditPage" || key === "violationPage") continue;
    params.set(key, String(value));
  }
  params.set(kind === "audit" ? "auditPage" : "violationPage", String(page));
  return `/auditoria?${params.toString()}`;
}

function Pager({ screen, kind }: Readonly<{ screen: AuditScreen; kind: "audit" | "violation" }>) {
  const data = kind === "audit" ? screen.audit : screen.violations;
  if (data.pageCount <= 1) return null;
  return <nav aria-label="Paginação" className="mt-4 flex items-center justify-end gap-3 text-sm">
    <span>Página {data.page} de {data.pageCount}</span>
    {data.page > 1 ? <Link className="underline" href={pageHref(screen, kind, data.page - 1)}>Anterior</Link> : null}
    {data.page < data.pageCount ? <Link className="underline" href={pageHref(screen, kind, data.page + 1)}>Próxima</Link> : null}
  </nav>;
}

function severityTone(value: string): StatusTone {
  if (value === "CRITICAL") return "danger";
  if (value === "HIGH" || value === "MEDIUM") return "warning";
  return "info";
}

function findingTone(value: string): StatusTone {
  if (value === "RESOLVED") return "success";
  if (value === "ACKNOWLEDGED") return "info";
  return "neutral";
}

export function AuditWorkspace({ initialScreen }: Readonly<{ initialScreen: AuditScreen }>) {
  const [screen, setScreen] = useState(initialScreen);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshScreen() {
    const response = await fetch(`/api/audit${window.location.search}`, { cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiError(body));
    setScreen(body as AuditScreen);
  }

  async function scan() {
    if (!window.confirm("Executar agora a detecção determinística de violações deste workspace?")) return;
    setBusy("scan");
    setNotice(null);
    try {
      const response = await fetch("/api/audit/process-health", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(body));
      const result = body as { created: number; refreshed: number; autoResolved: number };
      await refreshScreen();
      setNotice(`Varredura concluída: ${result.created} novo(s), ${result.refreshed} revalidado(s) e ${result.autoResolved} resolvido(s) automaticamente.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada na varredura.");
    } finally {
      setBusy(null);
    }
  }

  async function act(violationId: string, action: "ACKNOWLEDGE" | "RESOLVE", expectedUpdatedAt: string, reason?: string) {
    const verb = action === "ACKNOWLEDGE" ? "reconhecer" : "resolver";
    if (!window.confirm(`Confirma ${verb} este achado? O fato histórico e a auditoria serão preservados.`)) return;
    setBusy(violationId);
    setNotice(null);
    try {
      const response = await fetch(`/api/audit/process-health/${violationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedUpdatedAt, ...(reason ? { reason } : {}) }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(body));
      await refreshScreen();
      setNotice(action === "ACKNOWLEDGE" ? "Achado reconhecido e auditado." : "Achado resolvido sem apagar o fato original.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada na ação.");
    } finally {
      setBusy(null);
    }
  }

  return <div className={styles.workspace}>
    {notice ? <p className="rounded-md border bg-muted px-4 py-3 text-sm" role="status">{notice}</p> : null}

    <nav className={styles.sectionNav} aria-label="Seções de auditoria"><a href="#process-findings">Saúde do processo</a><a href="#audit-events">Trilha administrativa</a></nav>
    <Surface id="process-findings" aria-labelledby="health-heading" className="p-5" tone="subtle">
      <SectionHeader action={screen.capabilities.canManage ? <Button disabled={busy === "scan"} onClick={() => void scan()} type="button">{busy === "scan" ? "Verificando…" : "Atualizar achados"}</Button> : null} description="A detecção usa somente relações, timestamps e eventos persistidos; não depende de IA." eyebrow="Integridade operacional" title="Saúde determinística do processo" titleId="health-heading" />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Abertos" tone="warning" value={screen.summary.open} />
        <StatCard label="Reconhecidos" tone="info" value={screen.summary.acknowledged} />
        <StatCard label="Críticos ativos" tone="danger" value={screen.summary.critical} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {[screen.reconciliation.stalled, screen.reconciliation.withoutNextAction].map((item, index) => <div className="rounded-md border p-3 text-sm" key={index}>
          <p className="font-semibold">{index === 0 ? "Leads parados" : "Leads sem próxima ação"}</p>
          <p className="mt-1">Dashboard/regra atual: {item.dashboardCount} · achados ativos: {item.activeFindings}</p>
          <p className={item.reconciled ? "mt-1 text-emerald-700" : "mt-1 font-semibold text-amber-800"}>{item.reconciled ? "Reconciliado" : "Pendente de nova varredura"}</p>
        </div>)}
      </div>

      <form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="auditSearch" type="hidden" value={screen.filters.auditSearch} />
        <label className="text-xs font-semibold">Busca<input className={selectClass} defaultValue={screen.filters.violationSearch} name="violationSearch" placeholder="Título, evidência ou registro" /></label>
        <label className="text-xs font-semibold">Violação<select className={selectClass} defaultValue={screen.filters.violationType} name="violationType"><option value="">Todas</option>{processViolationTypes.map((value) => <option key={value} value={value}>{processViolationLabels[value]}</option>)}</select></label>
        <label className="text-xs font-semibold">Severidade<select className={selectClass} defaultValue={screen.filters.violationSeverity} name="violationSeverity"><option value="">Todas</option>{processViolationSeverities.map((value) => <option key={value} value={value}>{severityLabels[value]}</option>)}</select></label>
        <label className="text-xs font-semibold">Estado<select className={selectClass} defaultValue={screen.filters.violationStatus} name="violationStatus"><option value="">Todos</option>{processViolationStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
        <div className="flex items-end gap-2"><Button type="submit">Filtrar</Button><Button asChild variant="secondary"><Link href="/auditoria">Limpar</Link></Button></div>
      </form>

      {screen.violations.items.length === 0 ? <EmptyState className="mt-5" description="Use “Atualizar achados” se a varredura ainda não foi executada." title="Nenhum achado para os filtros informados" /> : <div className="mt-5 space-y-3">{screen.violations.items.map((item) => <article className="rounded-[0.875rem] border bg-card p-4 shadow-sm" key={item.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-sm">{item.evidenceSummary}</p><p className="mt-2 text-xs text-muted-foreground">{item.entityLabel} · detectado em {formatDate(item.detectedAt, screen.timeZone)}</p></div><div className="flex flex-wrap gap-2"><StatusBadge tone={severityTone(item.severity)}>Severidade {severityLabels[item.severity]}</StatusBadge><StatusBadge tone={findingTone(item.status)}>{statusLabels[item.status]}</StatusBadge></div></div>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Ver evidência concreta</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{json(item.evidence)}</pre>{item.resolutionReason ? <p className="mt-2"><strong>Resolução:</strong> {item.resolutionReason}</p> : null}</details>
        <div className="mt-4 flex flex-wrap items-end gap-3">{item.href ? <Button asChild size="sm" variant="secondary"><Link href={item.href}>Abrir registro e corrigir</Link></Button> : null}{screen.capabilities.canManage && item.status === "OPEN" ? <Button disabled={busy === item.id} onClick={() => void act(item.id, "ACKNOWLEDGE", item.updatedAt)} size="sm" type="button">Reconhecer</Button> : null}{screen.capabilities.canManage && item.status === "ACKNOWLEDGED" ? <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? ""); void act(item.id, "RESOLVE", item.updatedAt, reason); }}><label className="min-w-64 flex-1 text-xs font-semibold">Motivo da resolução<input className={selectClass} minLength={3} name="reason" placeholder="Descreva a correção feita pelo fluxo normal" required /></label><Button disabled={busy === item.id} size="sm" type="submit">Revalidar e resolver</Button></form> : null}</div>
      </article>)}</div>}
      <Pager kind="violation" screen={screen} />
      <p className="mt-4 text-xs text-muted-foreground">Exportação permanece desabilitada neste MVP até revisão específica de escopo, mascaramento e autorização.</p>
    </Surface>

    <Surface id="audit-events" aria-labelledby="audit-heading" className="p-5">
      <SectionHeader description="A interface mascara telefone, e-mail, token, credenciais e payload bruto; o fato original permanece protegido no banco." eyebrow="Governança" title="Trilha administrativa append-only" titleId="audit-heading" />
      <form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <label className="text-xs font-semibold">Busca<input className={selectClass} defaultValue={screen.filters.auditSearch} name="auditSearch" placeholder="Ação, entidade, ator ou request ID" /></label>
        <label className="text-xs font-semibold">Tipo de ator<select className={selectClass} defaultValue={screen.filters.auditActorType} name="auditActorType"><option value="">Todos</option>{actorTypes.map((value) => <option key={value} value={value}>{actorLabels[value]}</option>)}</select></label>
        <label className="text-xs font-semibold">Ator<select className={selectClass} defaultValue={screen.filters.auditActorId} name="auditActorId"><option value="">Todos</option>{screen.filterOptions.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name} · {actorLabels[actor.type]}</option>)}</select></label>
        <label className="text-xs font-semibold">Origem<select className={selectClass} defaultValue={screen.filters.auditOrigin} name="auditOrigin"><option value="">Todas</option>{auditOrigins.map((value) => <option key={value} value={value}>{originLabels[value]}</option>)}</select></label>
        <label className="text-xs font-semibold">Ação<select className={selectClass} defaultValue={screen.filters.auditAction} name="auditAction"><option value="">Todas</option>{screen.filterOptions.actions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs font-semibold">Entidade<select className={selectClass} defaultValue={screen.filters.auditEntityType} name="auditEntityType"><option value="">Todas</option>{screen.filterOptions.entityTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs font-semibold">De<input className={selectClass} defaultValue={screen.filters.auditFrom} name="auditFrom" type="datetime-local" /></label>
        <label className="text-xs font-semibold">Até<input className={selectClass} defaultValue={screen.filters.auditTo} name="auditTo" type="datetime-local" /></label>
        <div className="flex items-end gap-2"><Button type="submit">Filtrar</Button><Button asChild variant="secondary"><Link href="/auditoria">Limpar</Link></Button></div>
      </form>

      {screen.audit.items.length === 0 ? <EmptyState className="mt-5" description="Ajuste o período ou os critérios para consultar outros eventos." title="Nenhum evento de auditoria neste recorte" /> : <DataTableShell className="mt-5"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">Data</th><th className="p-3">Ator</th><th className="p-3">Ação/origem</th><th className="p-3">Registro</th><th className="p-3">Alteração</th></tr></thead><tbody>{screen.audit.items.map((item) => <tr className="border-b align-top" key={item.id}><td className="whitespace-nowrap p-3">{formatDate(item.occurredAt, screen.timeZone)}</td><td className="p-3"><span className="font-medium">{item.actor.name}</span><span className="block text-xs text-muted-foreground">{actorLabels[item.actor.type]}</span></td><td className="p-3"><code className="text-xs">{item.action}</code><span className="mt-1 block text-xs text-muted-foreground">{originLabels[item.origin] ?? item.origin}</span>{item.automationRunId ? <Link className="text-link mt-1 block text-xs" href={`/automacoes?runId=${item.automationRunId}`}>Execução relacionada</Link> : null}{item.aiInsightId ? <span className="mt-1 block text-xs">IA: {item.aiInsightId}</span> : null}</td><td className="p-3">{item.href ? <Link className="text-link font-medium" href={item.href}>{item.entityLabel}</Link> : <span>{item.entityLabel}</span>}<span className="mt-1 block text-xs text-muted-foreground">{item.entityId}</span></td><td className="max-w-md p-3"><details><summary className="cursor-pointer font-medium">Ver anterior, posterior e detalhes</summary><div className="mt-2 grid gap-2 text-xs"><div><strong>Anterior</strong><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2">{json(item.before)}</pre></div><div><strong>Posterior</strong><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2">{json(item.after)}</pre></div><div><strong>Detalhes seguros</strong><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2">{json(item.details)}</pre></div>{item.reason ? <p><strong>Motivo:</strong> {item.reason}</p> : null}</div></details></td></tr>)}</tbody></table></DataTableShell>}
      <Pager kind="audit" screen={screen} />
    </Surface>
  </div>;
}
