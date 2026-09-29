"use client";

import Link from "next/link";
import { useState } from "react";

import { NotificationCenter } from "@/app/automacoes/notification-center";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { AutomationOverview } from "@/modules/automations/application/automation-observability-service";
import type { NotificationScreen } from "@/modules/automations/application/notification-service";

function apiError(body: unknown) {
  if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error) return String(body.error.message);
  return "Não foi possível alterar a regra.";
}

function statusLabel(value: string) {
  return ({ ACTIVE: "Ativa", PAUSED: "Pausada", PENDING: "Pendente", RUNNING: "Executando", SUCCEEDED: "Sucesso", FAILED: "Falha", CANCELLED: "Cancelada" } as Record<string, string>)[value] ?? value;
}

function statusTone(value: string): StatusTone {
  if (value === "ACTIVE" || value === "SUCCEEDED") return "success";
  if (value === "FAILED") return "danger";
  if (value === "PENDING" || value === "RUNNING") return "warning";
  return "neutral";
}

export function AutomationsWorkspace({
  initialOverview,
  notifications,
}: Readonly<{ initialOverview: AutomationOverview; notifications: NotificationScreen }>) {
  const [overview, setOverview] = useState(initialOverview);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleRule(ruleId: string, current: string) {
    const status = current === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (!window.confirm(`${status === "ACTIVE" ? "Ativar" : "Pausar"} esta regra predefinida?`)) return;
    setBusyRuleId(ruleId);
    setNotice(null);
    try {
      const response = await fetch(`/api/automations/rules/${ruleId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: "Alteração confirmada na central de automações." }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(body));
      setOverview((currentOverview) => ({
        ...currentOverview,
        rules: currentOverview.rules.map((rule) => rule.id === ruleId ? { ...rule, status } : rule),
      }));
      setNotice(`Regra ${status === "ACTIVE" ? "ativada" : "pausada"} e auditada.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusyRuleId(null);
    }
  }

  return <div className="space-y-6">
    {notice ? <p className="rounded-md border bg-muted px-4 py-3 text-sm" role="status">{notice}</p> : null}
    <Surface className="p-5" tone="subtle">
      <SectionHeader description="As 12 regras usam serviços de domínio; não há editor visual ou integração externa." eyebrow="Motor local" title="Regras predefinidas" />
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {overview.rules.map((rule) => <article className="rounded-[0.875rem] border bg-card p-4 shadow-sm" key={rule.id}>
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{rule.name}</h3><p className="mt-1 text-sm text-muted-foreground">{rule.description}</p></div><StatusBadge tone={statusTone(rule.status)}>{statusLabel(rule.status)}</StatusBadge></div>
          <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-primary">Ver gatilho, condições e ações</summary><dl className="mt-3 grid gap-2 rounded-[var(--radius-control)] bg-muted p-3 text-xs"><div><dt className="font-semibold">Gatilho</dt><dd>{rule.triggerType}</dd></div><div><dt className="font-semibold">Ação</dt><dd>{rule.actionType}</dd></div><div><dt className="font-semibold">Versão</dt><dd>{rule.version}</dd></div><div><dt className="font-semibold">Condições persistidas</dt><dd className="break-all font-mono">{JSON.stringify(rule.conditions)}</dd></div><div><dt className="font-semibold">Configuração persistida</dt><dd className="break-all font-mono">{JSON.stringify(rule.actionConfig)}</dd></div></dl></details>
          {overview.capabilities.canManage && (rule.status === "ACTIVE" || rule.status === "PAUSED") ? <Button className="mt-4" disabled={busyRuleId === rule.id} onClick={() => void toggleRule(rule.id, rule.status)} size="sm" type="button" variant="secondary">{busyRuleId === rule.id ? "Salvando…" : rule.status === "ACTIVE" ? "Pausar" : "Ativar"}</Button> : null}
        </article>)}
      </div>
    </Surface>

    <Surface className="p-5">
      <SectionHeader action={<StatusBadge tone={overview.staleLocks > 0 ? "warning" : "success"}>Locks vencidos: {overview.staleLocks}</StatusBadge>} description="Falhas, tentativas e resultados permanecem inspecionáveis." eyebrow="Observabilidade" title="Histórico de execuções" />
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="text-xs font-semibold">Status<select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.status} name="status"><option value="">Todos</option>{["PENDING","RUNNING","SUCCEEDED","FAILED","CANCELLED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <label className="text-xs font-semibold">Regra<select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.ruleId} name="ruleId"><option value="">Todas</option>{overview.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Lead (ID)<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.leadId} name="leadId" /></label>
        <label className="text-xs font-semibold">De<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.from.slice(0, 16)} name="from" type="datetime-local" /></label>
        <label className="text-xs font-semibold">Até<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.to.slice(0, 16)} name="to" type="datetime-local" /></label>
        <div className="flex items-end gap-2"><Button type="submit">Filtrar</Button><Button asChild variant="secondary"><Link href="/automacoes">Limpar</Link></Button></div>
      </form>
      {overview.recentRuns.length === 0 ? <EmptyState className="mt-5" compact description="Ajuste o período ou remova filtros para consultar outras execuções." title="Nenhuma execução neste recorte" /> : <DataTableShell className="mt-5"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">Regra</th><th className="p-3">Registro</th><th className="p-3">Status</th><th className="p-3">Agendada</th><th className="p-3">Tentativas</th><th className="p-3">Resultado/erro</th></tr></thead><tbody>{overview.recentRuns.map((run) => <tr className="border-b align-top" key={run.id}><td className="p-3 font-medium">{run.rule.name}<span className="mt-1 block text-xs text-muted-foreground">v{run.ruleVersion}</span></td><td className="p-3">{run.leadId ? <Link className="text-link" href={`/leads/${run.leadId}/historico`}>{run.leadName ?? run.leadId}</Link> : run.meetingId ?? run.opportunityId ?? "Workspace"}</td><td className="p-3"><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></td><td className="p-3">{new Date(run.job?.runAt ?? run.triggeredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td><td className="p-3">{run.job?.attempts ?? 0}/{run.job?.maxAttempts ?? 0}</td><td className="max-w-sm p-3"><details><summary className="cursor-pointer">{run.errorMessage ?? (run.outputPayload ? "Ver resultado" : "Sem resultado")}</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(run.outputPayload ?? run.inputPayload ?? {}, null, 2)}</pre></details></td></tr>)}</tbody></table></DataTableShell>}
    </Surface>

    <NotificationCenter initialScreen={notifications} />
  </div>;
}
