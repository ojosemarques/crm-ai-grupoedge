"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import styles from "./pipeline-workspace.module.css";
import { DataTableShell } from "@/components/ui/surface";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import type {
  LeadPipelineCard,
  LeadPipelineState,
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

async function responseResult<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string }; result?: unknown };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível alterar a etapa.");
  return body.result as T;
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
  const [selectedLeadState, setSelectedLeadState] = useState<LeadPipelineState | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const cards = useMemo(() => allCards(screen.stages), [screen.stages]);
  const selectedLead = cards.find((lead) => lead.id === selectedLeadId) ?? null;
  const visibleStages = screen.filters.stageCode === "ALL"
    ? screen.stages
    : screen.stages.filter((stage) => stage.code === screen.filters.stageCode);

  async function transition(
    lead: LeadPipelineCard,
    state: LeadPipelineState,
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
          expectedUpdatedAt: state.updatedAt,
          ...data,
        }),
      });
      await responseResult(response);
      setNotice({ kind: "success", message: `${lead.fullName} foi movido para ${option.name}.` });
      setSelectedLeadId(null);
      setSelectedLeadState(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLead || !selectedLeadState) return;
    const form = new FormData(event.currentTarget);
    const managerCorrection = form.get("managerCorrection") === "on";
    const option = selectedLeadState.transitions.find((item) => item.stageId === form.get("targetStageId"));
    if (!option) return;
    await transition(selectedLead, selectedLeadState, option, {
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

  async function loadLeadState(lead: LeadPipelineCard): Promise<LeadPipelineState | null> {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${lead.id}/stage`, { cache: "no-store" });
      return await responseResult<LeadPipelineState>(response);
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
      return null;
    } finally {
      setPending(false);
    }
  }

  async function openTransition(lead: LeadPipelineCard) {
    const state = await loadLeadState(lead);
    if (!state) return;
    setSelectedLeadState(state);
    setSelectedLeadId(lead.id);
  }

  async function dropOnStage(event: React.DragEvent<HTMLElement>, stage: LeadPipelineStageColumn) {
    event.preventDefault();
    const lead = cards.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (!lead) return;
    const state = await loadLeadState(lead);
    const option = state?.transitions.find((item) => item.stageId === stage.id);
    if (!state || !option || !option.allowed || option.requiresConfirmation || option.requiresDisqualificationReason) {
      setNotice({ kind: "error", message: option?.blockReason ?? "Use Alterar etapa para concluir esta transição com os dados obrigatórios." });
      return;
    }
    await transition(lead, state, option, {
      reason: "Movido pelo quadro de pré-vendas.",
      managerCorrection: false,
      confirmed: false,
      origin: "PIPELINE_BOARD",
    });
  }

  return (
    <div className={styles.workspace}>
      <form className={styles.filters} method="get">
        <label className={styles.search}><span className="sr-only">Pesquisar negócios</span><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input defaultValue={screen.filters.q} name="q" placeholder="Buscar negócio..." /></label>
        <label className={styles.filter}>Dono do negócio<select aria-label="Dono do negócio" defaultValue={screen.filters.responsible} name="responsible"><option value="">Todos</option>{screen.responsibleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={styles.filter}>Prioridade<select aria-label="Prioridade" defaultValue={screen.filters.priority} name="priority"><option value="ALL">Todas</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></label>
        <label className={styles.filter}>Etapa<select aria-label="Etapa" defaultValue={screen.filters.stageCode} name="stageCode"><option value="ALL">Todas as etapas</option>{screen.stages.map((stage) => <option key={stage.id} value={stage.code}>{stage.name} ({stage.count})</option>)}</select></label>
        <input name="view" type="hidden" value={view} />
        <Button size="sm" type="submit" variant="secondary"><Icon name="filtro" size={14} />Aplicar</Button>
        <Link className={styles.clear} href="/pipeline">Limpar filtros</Link>
      </form>
      <div className={styles.boardToolbar}>
        <p><strong>{visibleStages.reduce((total, stage) => total + stage.count, 0)}</strong> negócios no pipeline <span className={styles.pipelineName}>{screen.pipelineName}</span></p>
        <div className={styles.tools}>
          <div aria-label="Alternar visualização" className={styles.viewSwitch}>
            <button aria-pressed={view === "board"} onClick={() => setView("board")} type="button"><Icon name="dashboard" size={14} />Quadro</button>
            <button aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><Icon name="auditoria" size={14} />Lista</button>
          </div>
          <button aria-label="Atualizar pipeline" className={styles.iconButton} onClick={() => router.refresh()} title="Atualizar" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></svg></button>
          <Link aria-label="Abrir lista de leads" className={styles.iconButton} href="/leads" title="Lista completa"><Icon name="leads" size={16} /></Link>
        </div>
      </div>

      {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" data-tone={notice.kind === "error" ? "danger" : "success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}

      {view === "board" ? (
        <section aria-label="Quadro do pipeline" className={styles.board}>
          {visibleStages.map((stage) => (
            <section aria-label={`Etapa ${stage.name}`} className={styles.lane} key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropOnStage(event, stage)}>
              <header className={styles.laneHeader}><div><h2>{stage.name}</h2><span>{stage.leads.filter((lead) => lead.nextActionAt).length} atividades agendadas</span></div><span aria-label={`${stage.count} leads nesta etapa`} className={styles.count}>{stage.count}</span></header>
              <div className={styles.cards}>
                {stage.leads.map((lead) => (
                  <article className={styles.card} draggable={screen.canWrite && !pending} key={lead.id} onDragStart={(event) => startDrag(event, lead)}>
                    <div className={styles.cardBody}>
                      <div className={styles.cardTop}><div className={styles.tags}><span className={styles.tag} data-tone={lead.priorityCode === "P1" ? "orange" : lead.priorityCode === "P2" ? "blue" : "purple"}>{lead.priorityCode ?? "Sem prioridade"}</span>{lead.pactoReady ? <span className={styles.tag} data-tone="green">PACTO pronto</span> : null}</div><span aria-label={`Responsável: ${lead.responsibleName}`} className={styles.avatarSquare} title={lead.responsibleName}>{lead.responsibleName.slice(0, 2).toUpperCase()}</span></div>
                      <div className={styles.cardTitle}><Link href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link><span title="Pontuação de qualificação">{lead.score === null ? "—" : `${lead.score}/100`}</span></div>
                      {lead.jobTitle ? <p className={styles.subtitle}>{lead.jobTitle}</p> : null}
                    </div>
                    <footer className={styles.cardFooter}>
                      <span aria-label={`Responsável: ${lead.responsibleName}`} className={styles.avatar} title={lead.responsibleName}>{lead.responsibleName.slice(0, 1).toUpperCase()}</span>
                      <Link aria-label={`Abrir atividades de ${lead.fullName}`} href={`/leads/${lead.id}/historico`} title="Atividades e histórico"><Icon name="meu-dia" size={13} /></Link>
                      <Link aria-label={`Abrir contato de ${lead.fullName}`} href={`/leads/${lead.id}`} title="Contato"><Icon name="leads" size={13} /></Link>
                      <span className={styles.activity} title={`${lead.nextActionDescription ?? "Sem próxima atividade"} · ${formatDate(lead.nextActionAt, screen.timeZone)}`}><Icon name="relogio" size={12} />{lead.nextActionAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: screen.timeZone }).format(new Date(lead.nextActionAt)) : "Sem prazo"}</span>
                      <button aria-label={`Alterar etapa de ${lead.fullName}`} className={styles.moveButton} disabled={!screen.canWrite || pending} onClick={() => void openTransition(lead)} title="Alterar etapa" type="button"><Icon name="seta-direita" size={13} /></button>
                    </footer>
                  </article>
                ))}
                {stage.displayedCount === 0 ? <div className={styles.emptyLane}><Icon name="pipeline" size={20} /><p>Nenhum negócio nesta etapa</p><span>Os negócios aparecerão aqui ao entrar nesta fase.</span></div> : null}
                {stage.count > stage.displayedCount ? <Link className={styles.moreCards} href="/leads">Ver todos os {stage.count} leads</Link> : null}
              </div>
            </section>
          ))}
        </section>
      ) : (
        <section className="space-y-2">
          {cards.length === 0 ? <EmptyState description="Ajuste os filtros ou cadastre um lead para começar." title="Nenhum negócio neste recorte" /> : null}
          {visibleStages.some((stage) => stage.count > stage.displayedCount) ? (
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Esta lista operacional mostra até {screen.cardLimitPerStage} leads por etapa. Use a lista completa para consultar todos os registros deste recorte.
            </p>
          ) : null}
          <DataTableShell>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted"><tr><th className="p-3">Lead</th><th className="p-3">Etapa</th><th className="p-3">Prioridade</th><th className="p-3">Responsável</th><th className="p-3">Próxima ação</th><th className="p-3">Ação</th></tr></thead>
              <tbody>{visibleStages.flatMap((stage) => stage.leads).map((lead) => (
                <tr className="border-b last:border-0" key={lead.id}><td className="p-3"><Link className="font-medium underline" href={`/leads/${lead.id}/historico`}>{lead.fullName}</Link></td><td className="p-3"><span className="stage-badge">{lead.currentStageName}</span></td><td className="p-3">{lead.score === null ? "Ausente" : <span className="priority-badge" data-priority={lead.priorityCode}>{lead.priorityCode} · {lead.score}</span>}</td><td className="p-3">{lead.responsibleName}</td><td className="p-3">{lead.nextActionDescription ?? "Ausente"}</td><td className="p-3"><Button disabled={!screen.canWrite || pending} onClick={() => void openTransition(lead)} size="sm" type="button" variant="secondary">Alterar etapa</Button></td></tr>
              ))}</tbody>
            </table>
          </DataTableShell>
        </section>
      )}

      {selectedLead && selectedLeadState ? (
        <AccessibleDialog busy={pending} labelledBy="transition-title" onDismiss={() => { setSelectedLeadId(null); setSelectedLeadState(null); }} className="max-w-xl">
          <form onSubmit={submitTransition}>
            <h2 className="text-xl font-bold" id="transition-title">Alterar etapa de {selectedLead.fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Etapa atual: {selectedLead.currentStageName}</p>
            {screen.canCorrect ? <label className="mt-4 flex items-center gap-2 text-sm"><input name="managerCorrection" type="checkbox" /> Registrar como correção gerencial</label> : null}
            <label className="mt-4 block text-sm">Etapa de destino
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="targetStageId" required>
                <option value="">Selecione</option>
                {selectedLeadState.transitions.map((option) => <option key={option.stageId} value={option.stageId}>{option.name}{option.allowed ? "" : ` — ${option.blockReason}`}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm">Motivo
              <textarea className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2" name="reason" required />
            </label>
            <label className="mt-4 block text-sm">Motivo de desqualificação
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="disqualificationReasonId"><option value="">Não se aplica</option>{selectedLeadState.disqualificationReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select>
            </label>
            <label className="mt-4 flex items-start gap-2 text-sm"><input name="confirmed" type="checkbox" /><span>Confirmo esta transição quando ela for sensível ou uma correção gerencial.</span></label>
            <ul className="mt-4 space-y-1 text-xs text-muted-foreground">{selectedLeadState.transitions.filter((option) => option.blockReason).map((option) => <li key={option.stageId}>{option.name}: {option.blockReason}</li>)}</ul>
            <div className="mt-6 flex justify-end gap-2"><Button disabled={pending} onClick={() => { setSelectedLeadId(null); setSelectedLeadState(null); }} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">{pending ? "Salvando…" : "Confirmar transição"}</Button></div>
          </form>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
