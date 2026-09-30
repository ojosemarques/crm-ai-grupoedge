"use client";

import Link from "next/link";
import { useState } from "react";

import { NotificationCenter } from "@/app/automacoes/notification-center";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Icon } from "@/components/ui/icon";
import styles from "./automations-workspace.module.css";

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
  return ({ DRAFT: "Rascunho", ARCHIVED: "Arquivada", ACTIVE: "Ativa", PAUSED: "Pausada", PENDING: "Pendente", RUNNING: "Executando", SUCCEEDED: "Sucesso", FAILED: "Falha", CANCELLED: "Cancelada" } as Record<string, string>)[value] ?? value;
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
  initialTab = "flows",
}: Readonly<{ initialOverview: AutomationOverview; notifications: NotificationScreen; initialTab?: "flows" | "history" }>) {
  const [overview, setOverview] = useState(initialOverview);
  const [selectedId, setSelectedId] = useState(initialOverview.rules[0]?.id ?? "");
  const [tab, setTab] = useState<string>(initialTab);
  const [confirmation, setConfirmation] = useState<{ id: string; status: string; name: string } | null>(null);
  const selectedRule = overview.rules.find((rule) => rule.id === selectedId);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleRule(ruleId: string, current: string) {
    const status = current === "ACTIVE" ? "PAUSED" : "ACTIVE";

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
      setConfirmation(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusyRuleId(null);
    }
  }

  return <div className={styles.workspace}>
    <nav aria-label="Áreas de automação" className={styles.tabs}>{[["flows", "Fluxos"], ["history", "Histórico de execuções"], ["notifications", "Notificações"]].map(([key, label]) => <button aria-current={tab === key ? "page" : undefined} key={key} onClick={() => setTab(key!)} type="button">{label}</button>)}</nav>
    {confirmation ? <AccessibleDialog labelledBy="automation-confirm-title" busy={busyRuleId !== null} onDismiss={() => setConfirmation(null)}><h2 id="automation-confirm-title">{confirmation.status === "ACTIVE" ? "Pausar" : "Ativar"} automação</h2><p className="mt-3 text-sm">{confirmation.name}</p><p className="mt-2 text-xs text-muted-foreground">A alteração será aplicada aos próximos eventos e registrada no histórico.</p><div className="mt-5 flex gap-2"><Button disabled={busyRuleId !== null} onClick={() => void toggleRule(confirmation.id, confirmation.status)}>{busyRuleId ? "Salvando…" : "Confirmar"}</Button><Button disabled={busyRuleId !== null} onClick={() => setConfirmation(null)} variant="secondary">Cancelar</Button></div>{notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}</AccessibleDialog> : null}
    {notice ? <p className="rounded-md border bg-muted px-4 py-3 text-sm" role="status">{notice}</p> : null}
    <section className={styles.flowLayout} hidden={tab !== "flows"}>
      <aside className={styles.ruleList}><header><Icon name="automacoes" size={16} /><h2>Minhas automações</h2><span>{overview.rules.length}</span></header>
        {overview.rules.map((rule) => <button aria-current={selectedId === rule.id ? "true" : undefined} key={rule.id} onClick={() => setSelectedId(rule.id)} type="button"><span className={styles.ruleIcon}><Icon name="automacoes" size={15} /></span><span><strong>{rule.name}</strong><small>{statusLabel(rule.status)} · versão {rule.version}</small></span><i data-active={rule.status === "ACTIVE"} /></button>)}
      </aside>
      {selectedRule ? <div className={styles.editor}>
        <header className={styles.editorHeader}><div><h2>{selectedRule.name}</h2><p>{selectedRule.description}</p></div><StatusBadge tone={statusTone(selectedRule.status)}>{statusLabel(selectedRule.status)}</StatusBadge>{overview.capabilities.canManage && (selectedRule.status === "ACTIVE" || selectedRule.status === "PAUSED") ? <Button disabled={busyRuleId === selectedRule.id} onClick={() => setConfirmation({ id: selectedRule.id, name: selectedRule.name, status: selectedRule.status })} size="sm" variant="secondary">{selectedRule.status === "ACTIVE" ? "Pausar fluxo" : "Ativar fluxo"}</Button> : null}</header>
        <div className={styles.canvas}>
          <article className={styles.node}><header><Icon name="pipeline" size={16} />Iniciar quando…</header><div><small>Gatilho</small><strong>{selectedRule.triggerType.replaceAll("_", " ").toLowerCase()}</strong><span>Evento recebido pelo CRM</span></div><footer>Próximo passo <i /></footer></article>
          <span aria-hidden="true" className={styles.connector}><Icon name="seta-direita" size={19} /></span>
          <article className={`${styles.node} ${styles.actionNode}`}><header><Icon name="automacoes" size={16} />Executar ação</header><div><small>Ação configurada</small><strong>{selectedRule.actionType.replaceAll("_", " ").toLowerCase()}</strong><span>{selectedRule.description}</span></div><footer>Concluir execução <i /></footer></article>
        </div>
        <details className={styles.configuration}><summary>Detalhes da configuração · versão {selectedRule.version}</summary><dl><div><dt>Condições</dt><dd><pre>{JSON.stringify(selectedRule.conditions, null, 2)}</pre></dd></div><div><dt>Parâmetros da ação</dt><dd><pre>{JSON.stringify(selectedRule.actionConfig, null, 2)}</pre></dd></div></dl></details>
      </div> : <EmptyState title="Nenhuma automação" description="As automações configuradas aparecerão aqui." />}
    </section>

    <Surface className="p-5" hidden={tab !== "history"}>
      <SectionHeader action={<StatusBadge tone={overview.staleLocks > 0 ? "warning" : "success"}>Locks vencidos: {overview.staleLocks}</StatusBadge>} description="Falhas, tentativas e resultados permanecem inspecionáveis." eyebrow="Observabilidade" title="Histórico de execuções" />
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="tab" type="hidden" value="history" />
        <label className="text-xs font-semibold">Status<select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.status} name="status"><option value="">Todos</option>{["PENDING","RUNNING","SUCCEEDED","FAILED","CANCELLED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <label className="text-xs font-semibold">Regra<select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.ruleId} name="ruleId"><option value="">Todas</option>{overview.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Lead (ID)<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.leadId} name="leadId" /></label>
        <label className="text-xs font-semibold">De<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.from.slice(0, 16)} name="from" type="datetime-local" /></label>
        <label className="text-xs font-semibold">Até<input className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" defaultValue={overview.filters.to.slice(0, 16)} name="to" type="datetime-local" /></label>
        <div className="flex items-end gap-2"><Button type="submit">Filtrar</Button><Button asChild variant="secondary"><Link href="/automacoes?tab=history">Limpar</Link></Button></div>
      </form>
      {overview.recentRuns.length === 0 ? <EmptyState className="mt-5" compact description="Ajuste o período ou remova filtros para consultar outras execuções." title="Nenhuma execução neste recorte" /> : <DataTableShell className="mt-5"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">Regra</th><th className="p-3">Registro</th><th className="p-3">Status</th><th className="p-3">Agendada</th><th className="p-3">Tentativas</th><th className="p-3">Resultado/erro</th></tr></thead><tbody>{overview.recentRuns.map((run) => <tr className="border-b align-top" key={run.id}><td className="p-3 font-medium">{run.rule.name}<span className="mt-1 block text-xs text-muted-foreground">v{run.ruleVersion}</span></td><td className="p-3">{run.leadId ? <Link className="text-link" href={`/leads/${run.leadId}/historico`}>{run.leadName ?? run.leadId}</Link> : run.meetingId ?? run.opportunityId ?? "Workspace"}</td><td className="p-3"><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></td><td className="p-3">{new Date(run.job?.runAt ?? run.triggeredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td><td className="p-3">{run.job?.attempts ?? 0}/{run.job?.maxAttempts ?? 0}</td><td className="max-w-sm p-3"><details><summary className="cursor-pointer">{run.errorMessage ?? (run.outputPayload ? "Ver resultado" : "Sem resultado")}</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(run.outputPayload ?? run.inputPayload ?? {}, null, 2)}</pre></details></td></tr>)}</tbody></table></DataTableShell>}
    </Surface>

    <div hidden={tab !== "notifications"}><NotificationCenter initialScreen={notifications} /></div>
  </div>;
}
