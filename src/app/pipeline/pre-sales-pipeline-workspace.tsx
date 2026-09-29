"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell } from "@/components/ui/surface";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import type {
  LeadPipelineCard,
  LeadPipelineStageColumn,
  PreSalesPipelineScreen,
  StageTransitionOption,
} from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "Ausente";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function queryHref(screen: PreSalesPipelineScreen, changes: Record<string, string>) {
  const query = new URLSearchParams({
    ...(screen.filters.q ? { q: screen.filters.q } : {}),
    ...(screen.filters.responsible ? { responsible: screen.filters.responsible } : {}),
    ...(screen.filters.priority !== "ALL" ? { priority: screen.filters.priority } : {}),
    ...(screen.filters.stageCode !== "ALL" ? { stageCode: screen.filters.stageCode } : {}),
    ...changes,
  });
  for (const [key, value] of [...query.entries()]) if (!value || value === "ALL") query.delete(key);
  return `/pipeline${query.size ? `?${query.toString()}` : ""}`;
}

async function responseResult(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string }; result?: unknown };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível alterar a etapa.");
  return body.result;
}

function allCards(stages: readonly LeadPipelineStageColumn[]) {
  return stages.flatMap((stage) => stage.leads);
}

export function PreSalesPipelineWorkspace({
  screen,
  initialView,
}: Readonly<{ screen: PreSalesPipelineScreen; initialView: "board" | "list" }>) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const cards = useMemo(() => allCards(screen.stages), [screen.stages]);
  const selectedLead = cards.find((lead) => lead.id === selectedLeadId) ?? null;
  const visibleStages = screen.filters.stageCode === "ALL"
    ? screen.stages
    : screen.stages.filter((stage) => stage.code === screen.filters.stageCode);

  async function transition(
    lead: LeadPipelineCard,
    option: StageTransitionOption,
    data: Readonly<{
      reason: string;
      managerCorrection: boolean;
      confirmed: boolean;
      disqualificationReasonId?: string | null;
      origin: "PIPELINE_BOARD" | "PIPELINE_LIST";
    }>,
  ) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${lead.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStageId: option.stageId,
          expectedUpdatedAt: lead.updatedAt,
          ...data,
        }),
      });
      await responseResult(response);
      setNotice({ kind: "success", message: `${lead.fullName} foi movido para ${option.name}.` });
      setSelectedLeadId(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    const managerCorrection = form.get("managerCorrection") === "on";
    const option = selectedLead.allowedTransitions.find((item) => item.stageId === form.get("targetStageId"));
    if (!option) return;
    await transition(selectedLead, option, {
      reason: String(form.get("reason") ?? ""),
      managerCorrection,
      confirmed: form.get("confirmed") === "on",
      disqualificationReasonId: String(form.get("disqualificationReasonId") ?? "") || null,
      origin: view === "board" ? "PIPELINE_BOARD" : "PIPELINE_LIST",
    });
  }

  function startDrag(event: React.DragEvent<HTMLElement>, lead: LeadPipelineCard) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", lead.id);
  }

  async function dropOnStage(event: React.DragEvent<HTMLElement>, stage: LeadPipelineStageColumn) {
    event.preventDefault();
    const lead = cards.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    const option = lead?.allowedTransitions.find((item) => item.stageId === stage.id);
    if (!lead || !option || !option.allowed || option.requiresConfirmation || option.requiresDisqualificationReason) {
      setNotice({ kind: "error", message: option?.blockReason ?? "Use Alterar etapa para concluir esta transição com os dados obrigatórios." });
      return;
    }
    await transition(lead, option, {
      reason: "Movido pelo quadro de pré-vendas.",
      managerCorrection: false,
      confirmed: false,
      origin: "PIPELINE_BOARD",
    });
  }

  return (
    <div className="space-y-5">
      <section className="surface-panel p-4">
        <form className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,16rem)_10rem_auto]" method="get">
          <label className="text-sm">Busca
            <input className="mt-1 w-full rounded-md border bg-background px-3 py-2" defaultValue={screen.filters.q} name="q" placeholder="Nome, cargo ou organização" />
          </label>
          <label className="text-sm">Responsável
            <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" defaultValue={screen.filters.responsible} name="responsible">
              <option value="">Todos</option>
              {screen.responsibleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-sm">Prioridade
            <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" defaultValue={screen.filters.priority} name="priority">
              <option value="ALL">Todas</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
            </select>
          </label>
          <div className="flex items-end gap-2"><Button type="submit">Filtrar</Button><Button asChild type="button" variant="secondary"><Link href="/pipeline">Limpar</Link></Button></div>
        </form>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Alternar visualização" className="flex gap-2">
          <Button onClick={() => setView("board")} type="button" variant={view === "board" ? "default" : "secondary"}>Quadro</Button>
          <Button onClick={() => setView("list")} type="button" variant={view === "list" ? "default" : "secondary"}>Lista</Button>
        </div>
        <Button asChild variant="secondary"><Link href="/leads">Abrir lista completa de leads</Link></Button>
      </div>

      {notice ? <p className={`rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}

      <nav aria-label="Contagens por etapa" className="flex gap-2 overflow-x-auto pb-1">
        {screen.stages.map((stage) => (
          <Link className={`whitespace-nowrap rounded-md border px-3 py-2 text-sm ${screen.filters.stageCode === stage.code ? "bg-primary text-primary-foreground" : "bg-card"}`} href={queryHref(screen, { stageCode: stage.code })} key={stage.id}>
            {stage.name} <strong>{stage.count}</strong>
          </Link>
        ))}
      </nav>

      {visibleStages.every((stage) => stage.count === 0) ? (
        <EmptyState description="Ajuste os filtros ou simule uma entrada de lead." title="Nenhum lead neste recorte" />
      ) : view === "board" ? (
        <section aria-label="Quadro do pipeline" className="flex snap-x gap-3 overflow-x-auto pb-5">
          {visibleStages.map((stage) => (
            <section
              aria-label={`Etapa ${stage.name}`}
              className="w-72 shrink-0 snap-start rounded-[var(--radius-panel)] border bg-[var(--surface-subtle)] p-3"
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void dropOnStage(event, stage)}
            >
              <header className="mb-3 flex items-center justify-between gap-2"><h2><span className="stage-badge">{stage.name}</span></h2><span aria-label={`${stage.count} leads nesta etapa`} className="rounded bg-background px-2 py-1 text-xs font-semibold">{stage.count}</span></header>
              <div className="space-y-3">
                {stage.leads.map((lead) => (
                  <article className="rounded-[0.875rem] border bg-card p-3 text-sm shadow-sm" draggable={screen.canWrite} key={lead.id} onDragStart={(event) => startDrag(event, lead)}>
                    <Link className="font-semibold underline" href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link>
                    <p className="mt-1 text-xs text-muted-foreground">{lead.jobTitle ?? "Atuação não informada"}</p>
                    <dl className="mt-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2"><dt>Prioridade</dt><dd>{lead.score === null ? "Ausente" : <><span className="priority-badge" data-priority={lead.priorityCode}>{lead.priorityCode}</span> <span>{lead.score}/100</span></>}</dd></div>
                      <div className="flex justify-between gap-2"><dt>Responsável</dt><dd className="text-right">{lead.responsibleName}</dd></div>
                      <div><dt className="text-muted-foreground">Próxima ação</dt><dd>{lead.nextActionDescription ?? "Ausente"} · {formatDate(lead.nextActionAt, screen.timeZone)}</dd></div>
                    </dl>
                    <Button className="mt-3 w-full" disabled={!screen.canWrite || pending} onClick={() => setSelectedLeadId(lead.id)} size="sm" type="button" variant="secondary">Alterar etapa</Button>
                  </article>
                ))}
                {stage.displayedCount === 0 ? <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">Etapa vazia neste recorte.</p> : null}
                {stage.count > stage.displayedCount ? <p className="text-xs text-muted-foreground">Mostrando {stage.displayedCount} de {stage.count}. Use a lista completa para ver todos.</p> : null}
              </div>
            </section>
          ))}
        </section>
      ) : (
        <section className="space-y-2">
          {visibleStages.some((stage) => stage.count > stage.displayedCount) ? (
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Esta lista operacional mostra até {screen.cardLimitPerStage} leads por etapa. Use a lista completa para consultar todos os registros deste recorte.
            </p>
          ) : null}
          <DataTableShell>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted"><tr><th className="p-3">Lead</th><th className="p-3">Etapa</th><th className="p-3">Prioridade</th><th className="p-3">Responsável</th><th className="p-3">Próxima ação</th><th className="p-3">Ação</th></tr></thead>
              <tbody>{visibleStages.flatMap((stage) => stage.leads).map((lead) => (
                <tr className="border-b last:border-0" key={lead.id}><td className="p-3"><Link className="font-medium underline" href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link></td><td className="p-3"><span className="stage-badge">{lead.currentStageName}</span></td><td className="p-3">{lead.score === null ? "Ausente" : <span className="priority-badge" data-priority={lead.priorityCode}>{lead.priorityCode} · {lead.score}</span>}</td><td className="p-3">{lead.responsibleName}</td><td className="p-3">{lead.nextActionDescription ?? "Ausente"}</td><td className="p-3"><Button disabled={!screen.canWrite || pending} onClick={() => setSelectedLeadId(lead.id)} size="sm" type="button" variant="secondary">Alterar etapa</Button></td></tr>
              ))}</tbody>
            </table>
          </DataTableShell>
        </section>
      )}

      {selectedLead ? (
        <AccessibleDialog busy={pending} labelledBy="transition-title" onDismiss={() => setSelectedLeadId(null)} className="max-w-xl">
          <form onSubmit={submitTransition}>
            <h2 className="text-xl font-bold" id="transition-title">Alterar etapa de {selectedLead.fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Etapa atual: {selectedLead.currentStageName}</p>
            {screen.canCorrect ? <label className="mt-4 flex items-center gap-2 text-sm"><input name="managerCorrection" type="checkbox" /> Registrar como correção gerencial</label> : null}
            <label className="mt-4 block text-sm">Etapa de destino
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="targetStageId" required>
                <option value="">Selecione</option>
                {selectedLead.allowedTransitions.map((option) => <option key={option.stageId} value={option.stageId}>{option.name}{option.allowed ? "" : ` — ${option.blockReason}`}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm">Motivo
              <textarea className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2" name="reason" required />
            </label>
            <label className="mt-4 block text-sm">Motivo de desqualificação
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="disqualificationReasonId"><option value="">Não se aplica</option>{screen.disqualificationReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select>
            </label>
            <label className="mt-4 flex items-start gap-2 text-sm"><input name="confirmed" type="checkbox" /><span>Confirmo esta transição quando ela for sensível ou uma correção gerencial.</span></label>
            <ul className="mt-4 space-y-1 text-xs text-muted-foreground">{selectedLead.allowedTransitions.filter((option) => option.blockReason).map((option) => <li key={option.stageId}>{option.name}: {option.blockReason}</li>)}</ul>
            <div className="mt-6 flex justify-end gap-2"><Button disabled={pending} onClick={() => setSelectedLeadId(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">{pending ? "Salvando…" : "Confirmar transição"}</Button></div>
          </form>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
