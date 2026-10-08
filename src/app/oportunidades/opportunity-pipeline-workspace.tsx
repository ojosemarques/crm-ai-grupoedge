"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import styles from "../pipeline/pipeline-workspace.module.css";
import { DataTableShell } from "@/components/ui/surface";
import { SalesGatesPanel } from "@/components/opportunities/sales-gates-panel";
import { AccountPlanPanel } from "@/components/opportunities/account-plan-panel";
import { InstantPipelineFilterForm } from "@/components/pipelines/instant-pipeline-filter-form";
import { SaleCompletionPanel } from "@/components/opportunities/sale-completion-panel";
import { useTouchPipelineControls } from "@/components/pipelines/use-touch-pipeline-controls";
import type {
  OpportunityListItem,
  OpportunityPipelineScreen,
  OpportunityStageColumn,
  OpportunityTransitionOption,
} from "@/modules/opportunities/domain/opportunity-contracts";

type BulkPreview = Readonly<{ operationId: string; selectedCount: number; eligibleCount: number; blocked: readonly Readonly<{ id: string; reason: string }>[] }>;

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

function money(cents: string) {
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  const integer = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0n ? "-" : ""}R$ ${integer},${(absolute % 100n).toString().padStart(2, "0")}`;
}

function date(value: string | null, timeZone: string) {
  if (!value) return "Ausente";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone })
    .format(new Date(value));
}

function reaisToCents(value: FormDataEntryValue | null) {
  const source = String(value ?? "").trim();
  if (!source) return "0";
  const normalized = source.includes(",")
    ? source.replace(/\./g, "").replace(",", ".")
    : source;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Informe um valor monetário válido em reais.");
  }
  return String(Math.round(amount * 100));
}

async function readResult(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível alterar a oportunidade.");
}

async function resultBody(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; result?: unknown };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível preparar a ação em massa.");
  return body.result;
}

function canCompleteWithTransitionForm(option: OpportunityTransitionOption) {
  return option.allowed || option.blockReason === "Crie uma próxima ação antes da transição.";
}

function OpportunityRow({ opportunity, timeZone, onSelect, onDragStart, onDragEnd, pending, dragging, touchControls }: Readonly<{
  opportunity: OpportunityListItem;
  timeZone: string;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  pending: boolean;
  dragging: boolean;
  touchControls: boolean;
}>) {
  return (
    <article className={styles.card} data-dragging={dragging || undefined} draggable={!touchControls && opportunity.canWrite && opportunity.status === "OPEN" && !pending} onClick={() => { if (!pending) onSelect(); }} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <div className={styles.cardBody}>
        <div className={styles.cardTop}><div className={styles.tags}><span className={styles.tag} data-tone={opportunity.status === "WON" ? "green" : opportunity.status === "LOST" ? "red" : "purple"}>{opportunity.status === "WON" ? "Ganho" : opportunity.status === "LOST" ? "Perdido" : opportunity.status === "CANCELLED" ? "Cancelado" : "Em aberto"}</span>{opportunity.productName ? <span className={styles.tag} data-tone="blue" title={opportunity.productName}>{opportunity.productName}</span> : null}</div><div className={styles.cardTopActions}><button aria-label={`Arrastar ${opportunity.name}`} className={styles.dragHandle} disabled={!opportunity.canWrite || opportunity.status !== "OPEN" || pending || touchControls} draggable={!touchControls && opportunity.canWrite && opportunity.status === "OPEN" && !pending} onClick={(event) => event.stopPropagation()} title="Arrastar para outra etapa" type="button">⠿</button><span aria-label={`Responsável: ${opportunity.ownerName}`} className={styles.avatarSquare} title={opportunity.ownerName}>{opportunity.ownerName.slice(0, 2).toUpperCase()}</span></div></div>
        <div className={styles.cardTitle}><button aria-label={`Abrir detalhes de ${opportunity.leadName}`} disabled={pending} draggable={false} onClick={(event) => { event.stopPropagation(); onSelect(); }} title={opportunity.name} type="button">{opportunity.name}</button><span>{money(opportunity.amountCents)}</span></div>
        <p className={styles.subtitle}>{opportunity.leadName}{opportunity.accountName ? ` · ${opportunity.accountName}` : ""}</p>
      </div>
      <footer className={styles.cardFooter}>
        <span aria-label={`Responsável: ${opportunity.ownerName}`} className={styles.avatar} title={opportunity.ownerName}>{opportunity.ownerName.slice(0, 1).toUpperCase()}</span>
        <button aria-label={`Abrir atividades de ${opportunity.leadName}`} disabled={pending} onClick={(event) => { event.stopPropagation(); onSelect(); }} title="Atividades e histórico" type="button"><Icon name="meu-dia" size={13} /></button>
        <button aria-label={`Abrir contato de ${opportunity.leadName}`} disabled={pending} onClick={(event) => { event.stopPropagation(); onSelect(); }} title="Contato" type="button"><Icon name="leads" size={13} /></button>
        <span className={styles.activity} title={`${opportunity.nextActionDescription ?? "Sem próxima atividade"} · ${date(opportunity.nextActionAt, timeZone)} · MRR ${money(opportunity.mrrCents)} / TCV ${money(opportunity.tcvCents)}`}><Icon name="relogio" size={12} />{opportunity.nextActionAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone }).format(new Date(opportunity.nextActionAt)) : "Sem prazo"}</span>
        {opportunity.canWrite && opportunity.status === "OPEN" ? <button aria-label={`Trabalhar oportunidade ${opportunity.name}`} className={styles.moveButton} disabled={pending} onClick={(event) => { event.stopPropagation(); onSelect(); }} title="Alterar etapa / proposta" type="button"><Icon name="seta-direita" size={13} /></button> : null}
        {opportunity.canWrite && opportunity.status === "OPEN" ? <button aria-label={`Mover ${opportunity.name} para outra etapa`} className={styles.mobileMoveButton} disabled={pending} onClick={(event) => { event.stopPropagation(); onSelect(); }} type="button">Mover para <Icon name="seta-direita" size={13} /></button> : null}
      </footer>
    </article>
  );
}

export function OpportunityPipelineWorkspace({ screen, initialOpportunityId = null }: Readonly<{ screen: OpportunityPipelineScreen; initialOpportunityId?: string | null }>) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "list" | "summary">("board");
  const [selectedId, setSelectedId] = useState<string | null>(initialOpportunityId);
  const [requestedStageId, setRequestedStageId] = useState("");
  const [draggedOpportunityId, setDraggedOpportunityId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [bulkAction, setBulkAction] = useState<"REASSIGN" | "TRANSITION">("REASSIGN");
  const touchControls = useTouchPipelineControls();
  const opportunities = useMemo(() => screen.stages.flatMap((stage) => stage.opportunities), [screen.stages]);
  const selected = opportunities.find((item) => item.id === selectedId) ?? null;
  const selectedOpportunities = opportunities.filter((item) => selectedIds.has(item.id));
  const summaries = useMemo(() => {
    const groups = new Map<string, { owner: string; count: number; amount: bigint; open: number; won: number; lost: number }>();
    for (const item of opportunities) {
      const current = groups.get(item.ownerName) ?? { owner: item.ownerName, count: 0, amount: 0n, open: 0, won: 0, lost: 0 };
      current.count += 1; current.amount += BigInt(item.amountCents);
      if (item.status === "OPEN") current.open += 1; else if (item.status === "WON") current.won += 1; else if (item.status === "LOST") current.lost += 1;
      groups.set(item.ownerName, current);
    }
    return [...groups.values()].sort((left, right) => right.count - left.count);
  }, [opportunities]);

  function toggleSelected(opportunityId: string) {
    setSelectedIds((current) => { const next = new Set(current); if (next.has(opportunityId)) next.delete(opportunityId); else next.add(opportunityId); return next; });
  }

  function startDrag(event: React.DragEvent<HTMLElement>, opportunity: OpportunityListItem) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-politizai-opportunity", opportunity.id);
    event.dataTransfer.setData("text/plain", opportunity.id);
    setDraggedOpportunityId(opportunity.id);
  }

  async function moveOpportunity(opportunity: OpportunityListItem, option: OpportunityTransitionOption) {
    setPending(true);
    setNotice(null);
    try {
      await readResult(await fetch(`/api/opportunities/${opportunity.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TRANSITION",
          targetStageId: option.stageId,
          expectedRevision: opportunity.revision,
          reason: "Movido pelo quadro de vendas.",
          origin: "OPPORTUNITY_BOARD",
          confirmed: false,
          lossReasonId: null,
        }),
      }));
      setNotice({ kind: "success", message: `${opportunity.name} foi movida para ${option.name}.` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function dropOpportunity(event: React.DragEvent<HTMLElement>, stage: OpportunityStageColumn) {
    event.preventDefault();
    setDropStageId(null);
    setDraggedOpportunityId(null);
    const opportunityId = event.dataTransfer.getData("application/x-politizai-opportunity") || event.dataTransfer.getData("text/plain") || draggedOpportunityId;
    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) return;
    if (opportunity.stageId === stage.id) {
      setNotice({ kind: "error", message: `${opportunity.name} já está em ${stage.name}.` });
      return;
    }
    const option = opportunity.transitions.find((item) => item.stageId === stage.id);
    if (!option) {
      setNotice({ kind: "error", message: "Esta etapa não está disponível para a oportunidade selecionada." });
      return;
    }
    if (option.code === "WON") {
      setRequestedStageId(stage.id);
      setSelectedId(opportunity.id);
      setNotice({ kind: "success", message: "Revise o cliente, as condições e o aceite para confirmar o fechamento integrado." });
      return;
    }
    if (!option.allowed || option.requiresConfirmation || option.requiresLossReason || option.code === "PROPOSAL") {
      setRequestedStageId(stage.id);
      setSelectedId(opportunity.id);
      setNotice({
        kind: canCompleteWithTransitionForm(option) ? "success" : "error",
        message: option.blockReason ?? "Complete os dados obrigatórios para concluir a movimentação.",
      });
      return;
    }
    await moveOpportunity(opportunity, option);
  }

  async function previewBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setPending(true); setNotice(null);
    try {
      const raw = await resultBody(await fetch("/api/opportunities/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        opportunityIds: selectedOpportunities.map((item) => item.id), action: form.get("action"), targetId: form.get("targetId"), reason: form.get("reason"),
        expectedRevisions: selectedOpportunities.map((item) => ({ id: item.id, revision: item.revision })),
      }) }));
      const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const blocked = Array.isArray(value.blocked) ? value.blocked.filter((item): item is { id: string; reason: string } => Boolean(item && typeof item === "object" && "id" in item && "reason" in item)) : [];
      setBulkPreview({ operationId: String(value.operationId ?? value.id ?? ""), selectedCount: Number(value.selectedCount ?? selectedOpportunities.length), eligibleCount: Number(value.eligibleCount ?? value.expectedCount ?? selectedOpportunities.length), blocked });
    } catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." }); }
    finally { setPending(false); }
  }

  async function executeBulk() {
    if (!bulkPreview) return; setPending(true); setNotice(null);
    try { await resultBody(await fetch("/api/opportunities/bulk", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: bulkPreview.operationId }) })); setBulkPreview(null); setSelectedIds(new Set()); setNotice({ kind: "success", message: "Ação em massa aplicada aos registros autorizados." }); router.refresh(); }
    catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." }); }
    finally { setPending(false); }
  }

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("nextActionTitle") ?? "").trim();
    const dueAtLocal = String(form.get("nextActionDueAt") ?? "").trim();
    setPending(true);
    setNotice(null);
    try {
      await readResult(await fetch(`/api/opportunities/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TRANSITION",
          targetStageId: String(form.get("targetStageId") ?? ""),
          expectedRevision: selected.revision,
          reason: String(form.get("reason") ?? ""),
          origin: view === "board" ? "OPPORTUNITY_BOARD" : "OPPORTUNITY_LIST",
          confirmed: form.get("confirmed") === "on",
          lossReasonId: String(form.get("lossReasonId") ?? "") || null,
          nextAction: title && dueAtLocal ? { title, dueAtLocal } : undefined,
        }),
      }));
      setNotice({ kind: "success", message: "Etapa comercial atualizada." });
      setSelectedId(null);
      setRequestedStageId("");
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function registerProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const nextActionTitle = String(form.get("nextActionTitle") ?? "").trim();
    const nextActionDueAt = String(form.get("nextActionDueAt") ?? "").trim();
    setPending(true);
    setNotice(null);
    try {
      await readResult(await fetch(`/api/opportunities/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PROPOSAL",
          expectedRevision: selected.revision,
          productId: String(form.get("productId") ?? ""),
          offerTemplateId: null,
          name: String(form.get("name") ?? ""),
          quantity: Number(form.get("quantity")),
          unitPriceCents: reaisToCents(form.get("unitPrice")),
          discountCents: reaisToCents(form.get("discount")),
          validUntilDate: String(form.get("validUntilDate") ?? "") || undefined,
          justification: String(form.get("justification") ?? "").trim() || undefined,
          confirmed: form.get("confirmed") === "on",
          nextAction: nextActionTitle && nextActionDueAt
            ? { title: nextActionTitle, dueAtLocal: nextActionDueAt }
            : undefined,
        }),
      }));
      setNotice({ kind: "success", message: "Proposta registrada com valores persistidos." });
      setSelectedId(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <InstantPipelineFilterForm
        action="/oportunidades"
        className={styles.filters}
        syncKey={`${screen.pipelineId}:${screen.filters.closerId}:${screen.filters.productId}:${screen.filters.stageCode}:${screen.filters.sourceId}:${screen.filters.from}:${screen.filters.to}`}
      >
        <input name="pipelineId" type="hidden" value={screen.pipelineId} />
        {screen.canFilterCloser ? <label className={styles.filter}>Dono do negócio<select aria-label="Dono do negócio" defaultValue={screen.filters.closerId} name="closerId"><option value="">Todos</option>{screen.closerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        <label className={styles.filter}>Produto<select aria-label="Produto" defaultValue={screen.filters.productId} name="productId"><option value="">Todos</option>{screen.productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={styles.filter}>Etapa<select aria-label="Etapa" defaultValue={screen.filters.stageCode} name="stageCode"><option value="ALL">Todas</option>{screen.stages.map((stage) => <option key={stage.id} value={stage.code}>{stage.name}</option>)}</select></label>
        {screen.sourceOptions.length ? <label className={styles.filter}>Origem<select aria-label="Origem" defaultValue={screen.filters.sourceId} name="sourceId"><option value="">Todas</option>{screen.sourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        <label className={styles.filter}>De<input defaultValue={screen.filters.from} name="from" type="date" /></label>
        <label className={styles.filter}>Até<input defaultValue={screen.filters.to} name="to" type="date" /></label>
        <Link className={styles.clear} href={`/oportunidades?pipelineId=${screen.pipelineId}`}>Limpar filtros</Link>
      </InstantPipelineFilterForm>
      <div className={styles.boardToolbar}>
        <p><strong>{screen.stages.reduce((total, stage) => total + stage.count, 0)}</strong> oportunidades de negócios <span className={styles.pipelineName}>{screen.pipelineName} · {money(opportunities.reduce((total, item) => total + BigInt(item.amountCents), BigInt(0)).toString())}</span></p>
        <div className={styles.tools}><div className={styles.viewSwitch} aria-label="Alternar visualização"><button aria-pressed={view === "board"} onClick={() => setView("board")} type="button"><Icon name="dashboard" size={14} />Quadro</button><button aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><Icon name="auditoria" size={14} />Lista</button><button aria-pressed={view === "summary"} onClick={() => setView("summary")} type="button"><Icon name="tendencia" size={14} />Consolidado</button></div><button aria-label="Atualizar oportunidades" className={styles.iconButton} onClick={() => router.refresh()} type="button"><Icon name="meu-dia" size={16} /></button></div>
      </div>
      {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" data-tone={notice.kind === "error" ? "danger" : "success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
      {view === "board" ? (
        <section aria-label="Pipeline de vendas" className={styles.board}>
          {screen.stages.map((stage) => (
            <section aria-label={`Etapa ${stage.name}`} className={styles.lane} data-drop-active={dropStageId === stage.id || undefined} key={stage.id} onDragEnter={() => setDropStageId(stage.id)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStageId(null); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => void dropOpportunity(event, stage)}>
              <header className={styles.laneHeader}><div><h2>{stage.name}</h2><span>{money(stage.opportunities.reduce((total, item) => total + BigInt(item.amountCents), BigInt(0)).toString())}</span></div><span aria-label={`${stage.count} oportunidades nesta etapa`} className={styles.count}>{stage.count}</span></header>
              <div className={styles.cards}>{stage.opportunities.map((opportunity) => <OpportunityRow dragging={draggedOpportunityId === opportunity.id} key={opportunity.id} opportunity={opportunity} timeZone={screen.timeZone} pending={pending} touchControls={touchControls} onDragEnd={() => { setDraggedOpportunityId(null); setDropStageId(null); }} onDragStart={(event) => startDrag(event, opportunity)} onSelect={() => { setRequestedStageId(""); setSelectedId(opportunity.id); }} />)}{stage.count === 0 ? <div className={styles.emptyLane}><Icon name="vendas" size={20} /><p>Nenhuma oportunidade</p><span>Os negócios aparecerão aqui ao entrar nesta fase.</span></div> : null}</div>
            </section>
          ))}
        </section>
      ) : view === "summary" ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{summaries.map((summary) => <article className="surface-panel p-5" key={summary.owner}><h2 className="font-semibold">{summary.owner}</h2><p className="mt-1 text-2xl font-semibold">{money(summary.amount.toString())}</p><dl className="mt-4 grid grid-cols-4 gap-2 text-center text-xs"><div><dt className="text-muted-foreground">Total</dt><dd className="mt-1 font-semibold">{summary.count}</dd></div><div><dt className="text-muted-foreground">Abertas</dt><dd className="mt-1 font-semibold">{summary.open}</dd></div><div><dt className="text-muted-foreground">Ganhas</dt><dd className="mt-1 font-semibold">{summary.won}</dd></div><div><dt className="text-muted-foreground">Perdidas</dt><dd className="mt-1 font-semibold">{summary.lost}</dd></div></dl></article>)}</section> : opportunities.length === 0 ? <EmptyState description="Crie uma oportunidade na ficha de um lead com reunião elegível." title="Nenhuma oportunidade neste recorte" /> : (
        <section className="grid gap-3">{selectedIds.size ? <form className="grid gap-3 rounded-md border bg-muted/30 p-4 md:grid-cols-4" onSubmit={previewBulk}><p className="self-center text-sm font-medium">{selectedIds.size} selecionadas</p><label className="text-sm">Ação<select className={inputClass} name="action" required value={bulkAction} onChange={(event) => setBulkAction(event.target.value as "REASSIGN" | "TRANSITION")}><option value="REASSIGN">Reatribuir dono</option><option value="TRANSITION">Mover etapa</option></select></label><label className="text-sm">Destino<select className={inputClass} name="targetId" required><option value="">Selecione</option>{bulkAction === "REASSIGN" ? screen.closerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : screen.stages.filter((item) => item.code !== "WON" && item.code !== "LOST").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm">Motivo<input className={inputClass} minLength={3} name="reason" required /></label><Button disabled={pending} type="submit" variant="secondary">Revisar ação em massa</Button></form> : null}<DataTableShell><table className="w-full min-w-[1100px] text-left text-sm"><thead className="sticky top-0 z-10 border-b bg-muted"><tr><th className="p-3"><span className="sr-only">Selecionar</span></th><th className="p-3">Oportunidade</th><th className="p-3">Lead</th><th className="p-3">Closer</th><th className="p-3">Origem</th><th className="p-3">Produto</th><th className="p-3">Etapa</th><th className="p-3">Valor</th><th className="p-3">Próxima ação</th><th className="p-3">Ação</th></tr></thead><tbody>{opportunities.map((opportunity) => <tr className="border-b last:border-0" key={opportunity.id}><td className="p-3"><input aria-label={`Selecionar ${opportunity.name}`} checked={selectedIds.has(opportunity.id)} disabled={!opportunity.canWrite || opportunity.status !== "OPEN"} onChange={() => toggleSelected(opportunity.id)} type="checkbox" /></td><td className="p-3 font-medium">{opportunity.name}</td><td className="p-3">{opportunity.leadName}</td><td className="p-3">{opportunity.ownerName}</td><td className="p-3">{opportunity.sourceName ?? "Não informada"}</td><td className="p-3">{opportunity.productName ?? opportunity.interestDescription ?? "Ausente"}</td><td className="p-3"><span className="stage-badge">{opportunity.stageName}</span></td><td className="p-3">{money(opportunity.amountCents)}</td><td className="p-3">{opportunity.nextActionDescription ?? "Encerrada"}</td><td className="p-3">{opportunity.canWrite && opportunity.status === "OPEN" ? <Button onClick={() => setSelectedId(opportunity.id)} size="sm" type="button" variant="secondary">Trabalhar oportunidade</Button> : "Somente leitura"}</td></tr>)}</tbody></table></DataTableShell></section>
      )}

      {bulkPreview ? <AccessibleDialog busy={pending} labelledBy="bulk-preview-title" onDismiss={() => setBulkPreview(null)}><h2 className="text-xl font-semibold" id="bulk-preview-title">Revisar ação em massa</h2><p className="mt-2 text-sm text-muted-foreground">{bulkPreview.eligibleCount} oportunidades foram revalidadas na prévia. A execução é atômica: se permissão, revisão ou destino mudar, nenhuma oportunidade será alterada.</p>{bulkPreview.blocked.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">{bulkPreview.blocked.map((item) => <li key={item.id}>{item.reason}</li>)}</ul> : null}<div className="mt-6 flex justify-end gap-2"><Button disabled={pending} onClick={() => setBulkPreview(null)} variant="secondary">Cancelar</Button><Button disabled={pending || bulkPreview.eligibleCount !== bulkPreview.selectedCount || !bulkPreview.operationId} onClick={() => void executeBulk()}>Executar todas</Button></div></AccessibleDialog> : null}

      {selected ? (
        <AccessibleDialog
          backdropClassName={styles.drawerBackdrop ?? ""}
          busy={pending}
          className={styles.opportunityDrawer ?? ""}
          labelledBy="opportunity-transition-title"
          onDismiss={() => { setSelectedId(null); setRequestedStageId(""); }}
        >
          <div className={styles.drawerHeader}>
            <div>
              <h2 className="text-xl font-bold" id="opportunity-transition-title">Trabalhar {selected.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Lead: {selected.leadName} · etapa atual: {selected.stageName}</p>
            </div>
            <button aria-label="Fechar painel" className={styles.drawerClose} disabled={pending} onClick={() => { setSelectedId(null); setRequestedStageId(""); }} title="Fechar" type="button">×</button>
          </div>
          <SalesGatesPanel opportunityId={selected.id} onCommitted={() => router.refresh()} />
          <AccountPlanPanel canWrite={selected.canWrite} memberOptions={screen.closerOptions} opportunityId={selected.id} timeZone={screen.timeZone} />
          <section className="rounded-md border p-4">
            <h3 className="font-semibold">Histórico de propostas</h3>
            {selected.offers.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma proposta registrada.</p> : <div className="mt-3 grid gap-2">{selected.offers.map((offer) => <article className="rounded-md border bg-muted/20 p-3 text-sm" key={offer.id}><div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-medium">{offer.name}</h4><p className="text-xs text-muted-foreground">{offer.productName} · {offer.lines.map((line) => `${line.quantity}× ${line.productName}`).join(", ")}</p></div><strong>{money(offer.totalCents)}</strong></div><p className="mt-2 text-xs">Validade: {offer.validUntil ? date(offer.validUntil, screen.timeZone) : "não informada"}{offer.acceptedAt ? ` · aceita em ${date(offer.acceptedAt, screen.timeZone)}` : ""}</p></article>)}</div>}
          </section>
          {selected.stageCode === "OPPORTUNITY_CONFIRMED" || selected.stageCode === "PROPOSAL" ? (
            <form className="grid gap-3 rounded-md border p-4" onSubmit={registerProposal}>
              <h3 className="font-semibold">Registrar proposta</h3>
              <label className="text-sm">Produto<select className={inputClass} defaultValue={selected.productId ?? ""} name="productId" required><option value="">Selecione</option>{screen.productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm">Nome da proposta<input className={inputClass} name="name" required /></label>
              <div className="grid gap-2 sm:grid-cols-3"><label className="text-sm">Quantidade<input className={inputClass} defaultValue="1" min="1" name="quantity" type="number" /></label><label className="text-sm">Valor unitário (R$)<input className={inputClass} inputMode="decimal" name="unitPrice" required /></label><label className="text-sm">Desconto (R$)<input className={inputClass} defaultValue="0" inputMode="decimal" name="discount" /></label></div>
              <label className="text-sm">Validade<input className={inputClass} name="validUntilDate" type="date" /></label>
              <label className="text-sm">Justificativa para valor zero<textarea className={inputClass} name="justification" /></label>
              <label className="text-sm">Nova próxima ação opcional<input className={inputClass} name="nextActionTitle" /></label>
              <label className="text-sm">Prazo opcional<input className={inputClass} name="nextActionDueAt" type="datetime-local" /></label>
              <label className="flex gap-2 text-sm"><input name="confirmed" required type="checkbox" /> Confirmo o registro desta proposta.</label>
              <Button disabled={pending} type="submit">Registrar proposta</Button>
            </form>
          ) : null}
          <SaleCompletionPanel key={`${selected.id}:${requestedStageId}`} opportunity={selected} sellers={screen.closerOptions} initiallyExpanded={selected.transitions.some((item) => item.stageId === requestedStageId && item.code === "WON")} onBusyChange={setPending} onCommitted={() => router.refresh()} />
          <form className="grid gap-3 rounded-md border p-4" onSubmit={transition}>
            <h3 className="font-semibold">Alterar etapa</h3>
            <label className="text-sm">Destino<select className={inputClass} defaultValue={requestedStageId} name="targetStageId" required><option value="">Selecione</option>{selected.transitions.filter((item) => item.code !== "PROPOSAL" && item.code !== "WON").map((item) => <option disabled={!canCompleteWithTransitionForm(item)} key={item.stageId} value={item.stageId}>{item.name}{item.blockReason ? ` — ${item.blockReason}` : ""}</option>)}</select></label>
            <p className="text-sm text-muted-foreground">Para marcar como ganho, use o fechamento integrado acima.</p>
            <label className="text-sm">Motivo<textarea className={inputClass} name="reason" required /></label>
            <label className="text-sm">Motivo de perda<select className={inputClass} name="lossReasonId"><option value="">Não se aplica</option>{screen.lossReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
            <label className="text-sm">Nova próxima ação opcional<input className={inputClass} name="nextActionTitle" /></label>
            <label className="text-sm">Prazo opcional<input className={inputClass} name="nextActionDueAt" type="datetime-local" /></label>
            <label className="flex gap-2 text-sm"><input name="confirmed" type="checkbox" /> Confirmo quando a transição for sensível.</label>
            <Button disabled={pending} type="submit">Confirmar transição</Button>
          </form>
          <div className="flex justify-end"><Button disabled={pending} onClick={() => { setSelectedId(null); setRequestedStageId(""); }} type="button" variant="secondary">Fechar</Button></div>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
