"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import styles from "./pipeline-workspace.module.css";
import { DataTableShell } from "@/components/ui/surface";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { useTouchPipelineControls } from "@/components/pipelines/use-touch-pipeline-controls";
import type { LeadCardOperations } from "@/modules/leads/domain/lead-card-contracts";
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

type LeadEntryOptions = Readonly<{
  sources: readonly Readonly<{ key: string; name: string }>[];
  priorityBands: readonly Readonly<{ code: "P1" | "P2" | "P3"; name: string }>[];
}>;

const quickInputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function optionalFormValue(form: FormData, name: string): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function QuickLeadDialog({
  pipelineId,
  pipelineName,
  onDismiss,
  onCreated,
}: Readonly<{
  pipelineId: string;
  pipelineName: string;
  onDismiss: () => void;
  onCreated: (message: string) => void;
}>) {
  const [options, setOptions] = useState<LeadEntryOptions | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/leads/entry-options", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          options?: LeadEntryOptions;
          error?: { message?: string };
        };
        if (!response.ok || !body.options) {
          throw new Error(body.error?.message ?? "Não foi possível carregar as opções do cadastro.");
        }
        setOptions(body.options);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Não foi possível carregar as opções do cadastro.");
        }
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          pipelineId,
          lead: {
            fullName: optionalFormValue(form, "fullName"),
            phone: optionalFormValue(form, "phone"),
            email: optionalFormValue(form, "email"),
            jobTitle: optionalFormValue(form, "jobTitle"),
            organizationName: optionalFormValue(form, "organizationName"),
            city: optionalFormValue(form, "city"),
            stateCode: optionalFormValue(form, "stateCode"),
            interestSummary: optionalFormValue(form, "interestSummary"),
            budgetBrl: optionalFormValue(form, "budgetBrl"),
            sourceKey: optionalFormValue(form, "sourceKey"),
            priorityBandCode: optionalFormValue(form, "priorityBandCode") ?? "P3",
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: { outcome?: "CREATED" | "ATTACHED"; issues?: readonly { message?: string }[] };
        error?: { message?: string };
      };
      if (!response.ok) {
        const issues = body.result?.issues?.flatMap((issue) => issue.message ? [issue.message] : []).join(" ");
        throw new Error(issues || body.error?.message || "Não foi possível cadastrar o lead.");
      }
      onCreated(body.result?.outcome === "ATTACHED"
        ? "O contato já existia e foi atualizado no CRM."
        : `Lead criado no pipeline ${pipelineName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar o lead.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AccessibleDialog busy={pending} labelledBy="quick-lead-title" onDismiss={onDismiss} className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <form className="grid gap-4" onSubmit={submit}>
        <header>
          <h2 id="quick-lead-title">Adicionar lead</h2>
          <p className="mt-1 text-sm text-muted-foreground">O lead entrará na primeira etapa do pipeline <strong>{pipelineName}</strong>.</p>
        </header>
        {error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p> : null}
        {!options && !error ? <p className="py-6 text-center text-sm text-muted-foreground" role="status">Carregando opções…</p> : null}
        {options ? <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Nome<input autoComplete="name" className={quickInputClass} name="fullName" required /></label>
          <label className="text-sm font-medium">Telefone<input autoComplete="tel" className={quickInputClass} name="phone" placeholder="(11) 98765-4321" required /></label>
          <label className="text-sm font-medium">E-mail<input autoComplete="email" className={quickInputClass} name="email" type="email" /></label>
          <label className="text-sm font-medium">Cargo ou atuação<input className={quickInputClass} name="jobTitle" /></label>
          <label className="text-sm font-medium">Partido, mandato ou equipe<input autoComplete="organization" className={quickInputClass} name="organizationName" /></label>
          <label className="text-sm font-medium">Orçamento (R$)<input className={quickInputClass} inputMode="decimal" name="budgetBrl" placeholder="6500,00" /></label>
          <label className="text-sm font-medium">Cidade<input autoComplete="address-level2" className={quickInputClass} name="city" /></label>
          <label className="text-sm font-medium">UF<input autoComplete="address-level1" className={quickInputClass} maxLength={2} name="stateCode" /></label>
          <label className="text-sm font-medium">Origem (opcional)<select className={quickInputClass} defaultValue="" name="sourceKey"><option value="">Não informar</option>{options.sources.map((source) => <option key={source.key} value={source.key}>{source.name}</option>)}</select></label>
          <label className="text-sm font-medium">Prioridade<select className={quickInputClass} defaultValue="P3" name="priorityBandCode">{options.priorityBands.map((band) => <option key={band.code} value={band.code}>{band.name}</option>)}</select></label>
          <label className="text-sm font-medium sm:col-span-2">Dor ou interesse<textarea className={`${quickInputClass} min-h-24 py-2`} name="interestSummary" /></label>
        </div> : null}
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onDismiss} type="button" variant="secondary">Cancelar</Button>
          <Button disabled={pending || !options} type="submit"><Icon name="mais" size={14} />{pending ? "Cadastrando…" : "Adicionar lead"}</Button>
        </div>
      </form>
    </AccessibleDialog>
  );
}

export function PreSalesPipelineWorkspace({
  screen,
  initialView,
}: Readonly<{ screen: PreSalesPipelineScreen; initialView: "board" | "list" }>) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadState, setSelectedLeadState] = useState<LeadPipelineState | null>(null);
  const [selectedLeadOperations, setSelectedLeadOperations] = useState<LeadCardOperations | null>(null);
  const [requestedStageId, setRequestedStageId] = useState<string>("");
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const touchControls = useTouchPipelineControls();
  const cards = useMemo(() => allCards(screen.stages), [screen.stages]);
  const selectedLead = cards.find((lead) => lead.id === selectedLeadId) ?? null;
  const visibleStages = screen.filters.stageCode === "ALL"
    ? screen.stages
    : screen.stages.filter((stage) => stage.code === screen.filters.stageCode);

  function openLeadCard(lead: LeadPipelineCard, anchor?: string) {
    router.push(`/leads/${lead.id}/historico${anchor ? `#${anchor}` : ""}`);
  }

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
      setSelectedLeadOperations(null);
      setRequestedStageId("");
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
    event.dataTransfer.setData("application/x-politizai-lead", lead.id);
    event.dataTransfer.setData("text/plain", lead.id);
    setDraggedLeadId(lead.id);
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
    setSelectedLeadId(lead.id);
    setSelectedLeadState(null);
    setSelectedLeadOperations(null);
    setRequestedStageId("");
    setPending(true);
    setNotice(null);
    try {
      const [stateResponse, operationsResponse] = await Promise.all([
        fetch(`/api/leads/${lead.id}/stage`, { cache: "no-store" }),
        fetch(`/api/leads/${lead.id}/operations?pageSize=8`, { cache: "no-store" }),
      ]);
      const [state, operations] = await Promise.all([
        responseResult<LeadPipelineState>(stateResponse),
        responseResult<LeadCardOperations>(operationsResponse),
      ]);
      setSelectedLeadState(state);
      setSelectedLeadOperations(operations);
    } catch (error) {
      setSelectedLeadId(null);
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  function closeLeadDrawer() {
    setSelectedLeadId(null);
    setSelectedLeadState(null);
    setSelectedLeadOperations(null);
    setRequestedStageId("");
  }

  async function dropOnStage(event: React.DragEvent<HTMLElement>, stage: LeadPipelineStageColumn) {
    event.preventDefault();
    setDropStageId(null);
    setDraggedLeadId(null);
    const leadId = event.dataTransfer.getData("application/x-politizai-lead") || event.dataTransfer.getData("text/plain") || draggedLeadId;
    const lead = cards.find((item) => item.id === leadId);
    if (!lead) return;
    const state = await loadLeadState(lead);
    const option = state?.transitions.find((item) => item.stageId === stage.id);
    if (!state) return;
    if (state.currentStageId === stage.id) {
      setNotice({ kind: "error", message: `${lead.fullName} já está em ${stage.name}.` });
      return;
    }
    if (!option) {
      setNotice({ kind: "error", message: "Esta etapa não está disponível para o lead selecionado." });
      return;
    }
    if (!option.allowed || option.requiresConfirmation || option.requiresDisqualificationReason) {
      await openTransition(lead);
      setRequestedStageId(stage.id);
      setNotice({
        kind: option.blockReason ? "error" : "success",
        message: option.blockReason ?? "Complete os dados obrigatórios para concluir a movimentação.",
      });
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
        <input name="pipelineId" type="hidden" value={screen.pipelineId} />
        <label className={styles.search}><span className="sr-only">Pesquisar negócios</span><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input defaultValue={screen.filters.q} name="q" placeholder="Buscar negócio..." /></label>
        <label className={styles.filter}>Dono do negócio<select aria-label="Dono do negócio" defaultValue={screen.filters.responsible} name="responsible"><option value="">Todos</option>{screen.responsibleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={styles.filter}>Prioridade<select aria-label="Prioridade" defaultValue={screen.filters.priority} name="priority"><option value="ALL">Todas</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></label>
        <label className={styles.filter}>Etapa<select aria-label="Etapa" defaultValue={screen.filters.stageCode} name="stageCode"><option value="ALL">Todas as etapas</option>{screen.stages.map((stage) => <option key={stage.id} value={stage.code}>{stage.name} ({stage.count})</option>)}</select></label>
        <input name="view" type="hidden" value={view} />
        <Button size="sm" type="submit" variant="secondary"><Icon name="filtro" size={14} />Aplicar</Button>
        {screen.canWrite ? <Button onClick={() => setQuickCreateOpen(true)} size="sm" type="button"><Icon name="mais" size={14} />Adicionar</Button> : null}
        <Link className={styles.clear} href={`/pipeline?pipelineId=${screen.pipelineId}`}>Limpar filtros</Link>
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
            <section
              aria-label={`Etapa ${stage.name}`}
              className={styles.lane}
              data-drop-active={dropStageId === stage.id || undefined}
              key={stage.id}
              onDragEnter={() => setDropStageId(stage.id)}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStageId(null); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={(event) => void dropOnStage(event, stage)}
            >
              <header className={styles.laneHeader}><div><h2>{stage.name}</h2><span>{stage.leads.filter((lead) => lead.nextActionAt).length} atividades agendadas</span></div><span aria-label={`${stage.count} leads nesta etapa`} className={styles.count}>{stage.count}</span></header>
              <div className={styles.cards}>
                {stage.leads.map((lead) => (
                  <article className={styles.card} data-dragging={draggedLeadId === lead.id || undefined} draggable={!touchControls && screen.canWrite && !pending} key={lead.id} onClick={() => { if (!pending) openLeadCard(lead); }} onDragEnd={() => { setDraggedLeadId(null); setDropStageId(null); }} onDragStart={(event) => startDrag(event, lead)}>
                    <div className={styles.cardBody}>
                      <div className={styles.cardTop}><div className={styles.tags}><span className={styles.tag} data-tone={lead.priorityCode === "P1" ? "orange" : lead.priorityCode === "P2" ? "blue" : "purple"}>{lead.priorityCode ?? "Sem prioridade"}</span>{lead.pactoReady ? <span className={styles.tag} data-tone="green">PACTO pronto</span> : null}</div><div className={styles.cardTopActions}><button aria-label={`Arrastar ${lead.fullName}`} className={styles.dragHandle} disabled={!screen.canWrite || pending || touchControls} draggable={!touchControls && screen.canWrite && !pending} onClick={(event) => event.stopPropagation()} title="Arrastar para outra etapa" type="button">⠿</button><span aria-label={`Responsável: ${lead.responsibleName}`} className={styles.avatarSquare} title={lead.responsibleName}>{lead.responsibleName.slice(0, 2).toUpperCase()}</span></div></div>
                      <div className={styles.cardTitle}><button aria-label={`Abrir ficha completa de ${lead.fullName}`} disabled={pending} draggable={false} onClick={(event) => { event.stopPropagation(); openLeadCard(lead); }} type="button">{lead.fullName}</button><span title="Pontuação de qualificação">{lead.score === null ? "—" : `${lead.score}/100`}</span></div>
                      {lead.jobTitle ? <p className={styles.subtitle}>{lead.jobTitle}</p> : null}
                    </div>
                    <footer className={styles.cardFooter}>
                      <span aria-label={`Responsável: ${lead.responsibleName}`} className={styles.avatar} title={lead.responsibleName}>{lead.responsibleName.slice(0, 1).toUpperCase()}</span>
                      <button aria-label={`Abrir atividades de ${lead.fullName}`} disabled={pending} onClick={(event) => { event.stopPropagation(); openLeadCard(lead, "registrar-atividade"); }} title="Atividades" type="button"><Icon name="meu-dia" size={13} /></button>
                      <button aria-label={`Abrir tarefas de ${lead.fullName}`} disabled={pending} onClick={(event) => { event.stopPropagation(); openLeadCard(lead, "tarefas"); }} title="Tarefas e lembretes" type="button"><Icon name="agenda" size={13} /></button>
                      <button aria-label={`Abrir reuniões de ${lead.fullName}`} disabled={pending} onClick={(event) => { event.stopPropagation(); openLeadCard(lead, "reunioes"); }} title="Reuniões" type="button"><Icon name="mais" size={13} /></button>
                      <span className={styles.activity} title={`${lead.nextActionDescription ?? "Sem próxima atividade"} · ${formatDate(lead.nextActionAt, screen.timeZone)}`}><Icon name="relogio" size={12} />{lead.nextActionAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: screen.timeZone }).format(new Date(lead.nextActionAt)) : "Sem prazo"}</span>
                      <button aria-label={`Alterar etapa de ${lead.fullName}`} className={styles.moveButton} disabled={!screen.canWrite || pending} onClick={(event) => { event.stopPropagation(); void openTransition(lead); }} title="Alterar etapa" type="button"><Icon name="seta-direita" size={13} /></button>
                      <button aria-label={`Mover ${lead.fullName} para outra etapa`} className={styles.mobileMoveButton} disabled={!screen.canWrite || pending} onClick={(event) => { event.stopPropagation(); void openTransition(lead); }} type="button">Mover para <Icon name="seta-direita" size={13} /></button>
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
                <tr className="border-b last:border-0" key={lead.id}><td className="p-3"><button className="font-medium underline" disabled={pending} onClick={() => openLeadCard(lead)} type="button">{lead.fullName}</button></td><td className="p-3"><span className="stage-badge">{lead.currentStageName}</span></td><td className="p-3">{lead.score === null ? "Ausente" : <span className="priority-badge" data-priority={lead.priorityCode}>{lead.priorityCode} · {lead.score}</span>}</td><td className="p-3">{lead.responsibleName}</td><td className="p-3">{lead.nextActionDescription ?? "Ausente"}</td><td className="p-3"><Button disabled={pending} onClick={() => openLeadCard(lead)} size="sm" type="button" variant="secondary">Abrir lead</Button></td></tr>
              ))}</tbody>
            </table>
          </DataTableShell>
        </section>
      )}

      {selectedLead ? (
        <AccessibleDialog backdropClassName={styles.drawerBackdrop ?? ""} busy={pending} labelledBy="transition-title" onDismiss={closeLeadDrawer} className={styles.opportunityDrawer ?? ""}>
          <div className={styles.drawerHeader}>
            <div><h2 className="text-xl font-bold" id="transition-title">{selectedLead.fullName}</h2><p className="mt-1 text-sm text-muted-foreground">Etapa atual: {selectedLead.currentStageName}</p></div>
            <button aria-label="Fechar painel" className={styles.drawerClose} disabled={pending} onClick={closeLeadDrawer} title="Fechar" type="button">×</button>
          </div>
          {!selectedLeadState || !selectedLeadOperations ? <p aria-live="polite" className="py-10 text-center text-sm text-muted-foreground">Carregando informações do lead…</p> : <>
          <section className="grid gap-3 rounded-md border p-4 sm:grid-cols-2" aria-label="Resumo do lead">
            <div><p className="text-xs text-muted-foreground">Telefone</p><p className="text-sm font-medium">{selectedLeadOperations.lead.normalizedPhone ?? "Não informado"}</p></div>
            <div><p className="text-xs text-muted-foreground">E-mail</p><p className="break-all text-sm font-medium">{selectedLeadOperations.lead.normalizedEmail ?? "Não informado"}</p></div>
            <div><p className="text-xs text-muted-foreground">Responsável</p><p className="text-sm font-medium">{selectedLeadOperations.lead.operationalOwner}</p></div>
            <div><p className="text-xs text-muted-foreground">Origem</p><p className="text-sm font-medium">{selectedLeadOperations.lead.sourceName}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Dor ou interesse</p><p className="text-sm">{selectedLeadOperations.lead.interestSummary ?? "Não informado"}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Próxima ação</p><p className="text-sm font-medium">{selectedLeadOperations.lead.nextAction ? `${selectedLeadOperations.lead.nextAction.title} · ${formatDate(selectedLeadOperations.lead.nextAction.dueAt, screen.timeZone)}` : "Nenhuma próxima ação agendada"}</p></div>
          </section>
          <section className="rounded-md border p-4" aria-label="Atividades recentes">
            <h3 className="font-semibold">Atividades recentes</h3>
            {selectedLeadOperations.timeline.length ? <ul className="mt-3 grid gap-2">{selectedLeadOperations.timeline.slice(0, 5).map((entry) => <li className="rounded-md bg-muted/30 p-3 text-sm" key={entry.id}><div className="flex justify-between gap-3"><strong>{entry.subject}</strong><span className="text-xs text-muted-foreground">{formatDate(entry.occurredAt, screen.timeZone)}</span></div>{entry.description ? <p className="mt-1 text-muted-foreground">{entry.description}</p> : null}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhuma atividade registrada.</p>}
          </section>
          <section className="rounded-md border p-4" aria-label="Lembretes do lead">
            <h3 className="font-semibold">Lembretes e tarefas</h3>
            {selectedLeadOperations.tasks.length ? <ul className="mt-3 grid gap-2">{selectedLeadOperations.tasks.slice(0, 5).map((task) => <li className="flex items-start justify-between gap-3 rounded-md bg-muted/30 p-3 text-sm" key={task.id}><span>{task.title}</span><span className="text-xs text-muted-foreground">{formatDate(task.dueAt, screen.timeZone)}</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhum lembrete pendente.</p>}
          </section>
          {screen.canWrite ? <form className="rounded-md border p-4" onSubmit={submitTransition}>
            <h3 className="font-semibold">Mover para outra etapa</h3>
            {screen.canCorrect ? <label className="mt-4 flex items-center gap-2 text-sm"><input name="managerCorrection" type="checkbox" /> Registrar como correção gerencial</label> : null}
            <label className="mt-4 block text-sm">Etapa de destino
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" defaultValue={requestedStageId} name="targetStageId" required>
                <option value="">Selecione</option>
                {selectedLeadState.transitions.map((option) => <option key={option.stageId} value={option.stageId}>{option.name}{option.allowed ? "" : ` — ${option.blockReason}`}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm">Motivo (opcional)
              <textarea className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2" name="reason" />
            </label>
            <label className="mt-4 block text-sm">Motivo de desqualificação (opcional)
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="disqualificationReasonId"><option value="">Não se aplica</option>{selectedLeadState.disqualificationReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select>
            </label>
            <div className="mt-6 flex justify-end gap-2"><Button disabled={pending} onClick={closeLeadDrawer} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">{pending ? "Salvando…" : "Confirmar transição"}</Button></div>
          </form> : null}
          </>}
        </AccessibleDialog>
      ) : null}
      {quickCreateOpen ? <QuickLeadDialog
        onCreated={(message) => {
          setQuickCreateOpen(false);
          setNotice({ kind: "success", message });
          router.refresh();
        }}
        onDismiss={() => setQuickCreateOpen(false)}
        pipelineId={screen.pipelineId}
        pipelineName={screen.pipelineName}
      /> : null}
    </div>
  );
}
