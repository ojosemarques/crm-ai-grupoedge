"use client";

import Link from "next/link";
import { useState } from "react";

import { AutomationBuilder } from "@/app/automacoes/automation-builder";
import { NotificationCenter } from "@/app/automacoes/notification-center";
import styles from "./automations-workspace.module.css";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { AutomationOverview } from "@/modules/automations/application/automation-observability-service";
import type { NotificationScreen } from "@/modules/automations/application/notification-service";

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
  const [overview] = useState(initialOverview);
  const [tab, setTab] = useState<string>(initialTab);

  return <div className={styles.workspace}>
    <nav aria-label="Áreas de automação" className={styles.tabs}>{[["flows", "Fluxos"], ["history", "Histórico de execuções"], ["notifications", "Notificações"]].map(([key, label]) => <button aria-current={tab === key ? "page" : undefined} key={key} onClick={() => setTab(key!)} type="button">{label}</button>)}</nav>
    <section hidden={tab !== "flows"}><AutomationBuilder /></section>

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
