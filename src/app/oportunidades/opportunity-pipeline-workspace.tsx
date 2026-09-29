"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell } from "@/components/ui/surface";
import type {
  OpportunityListItem,
  OpportunityPipelineScreen,
} from "@/modules/opportunities/domain/opportunity-contracts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

function money(cents: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(cents) / 100);
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

function OpportunityRow({ opportunity, timeZone }: Readonly<{ opportunity: OpportunityListItem; timeZone: string }>) {
  return (
    <article className="rounded-[0.875rem] border bg-card p-3 text-sm shadow-sm">
      <h3 className="font-semibold">{opportunity.name}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{opportunity.leadName} · {opportunity.ownerName}</p>
      <dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between gap-2"><dt>Produto</dt><dd className="text-right">{opportunity.productName ?? opportunity.interestDescription ?? "Ausente"}</dd></div><div className="flex justify-between gap-2"><dt>Valor</dt><dd>{money(opportunity.amountCents)}</dd></div><div className="flex justify-between gap-2"><dt>MRR / TCV</dt><dd>{money(opportunity.mrrCents)} / {money(opportunity.tcvCents)}</dd></div><div><dt className="text-muted-foreground">Próxima ação</dt><dd>{opportunity.nextActionDescription ?? "Encerrada"} · {date(opportunity.nextActionAt, timeZone)}</dd></div></dl>
    </article>
  );
}

export function OpportunityPipelineWorkspace({ screen }: Readonly<{ screen: OpportunityPipelineScreen }>) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "list">("board");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const opportunities = useMemo(() => screen.stages.flatMap((stage) => stage.opportunities), [screen.stages]);
  const selected = opportunities.find((item) => item.id === selectedId) ?? null;

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
    <div className="space-y-5">
      <form className="surface-panel grid gap-3 p-4 md:grid-cols-5" method="get">
        {screen.canFilterCloser ? <label className="text-sm">Closer<select className={inputClass} defaultValue={screen.filters.closerId} name="closerId"><option value="">Todos</option>{screen.closerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        <label className="text-sm">Produto<select className={inputClass} defaultValue={screen.filters.productId} name="productId"><option value="">Todos</option>{screen.productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm">Etapa<select className={inputClass} defaultValue={screen.filters.stageCode} name="stageCode"><option value="ALL">Todas</option>{screen.stages.map((stage) => <option key={stage.id} value={stage.code}>{stage.name}</option>)}</select></label>
        <label className="text-sm">Entrada desde<input className={inputClass} defaultValue={screen.filters.from} name="from" type="date" /></label>
        <label className="text-sm">Entrada até<input className={inputClass} defaultValue={screen.filters.to} name="to" type="date" /></label>
        <div className="flex items-end gap-2 md:col-span-5"><Button type="submit">Filtrar</Button><Button asChild type="button" variant="secondary"><Link href="/oportunidades">Limpar</Link></Button></div>
      </form>

      <div className="flex gap-2" aria-label="Alternar visualização"><Button onClick={() => setView("board")} type="button" variant={view === "board" ? "default" : "secondary"}>Quadro</Button><Button onClick={() => setView("list")} type="button" variant={view === "list" ? "default" : "secondary"}>Lista</Button></div>
      {notice ? <p className={`rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
      {opportunities.length === 0 ? <EmptyState description="Crie uma oportunidade a partir da aba Oportunidade de um lead com reunião elegível." title="Nenhuma oportunidade neste recorte" /> : view === "board" ? (
        <section aria-label="Pipeline de vendas" className="flex snap-x gap-3 overflow-x-auto pb-5">{screen.stages.map((stage) => <section aria-label={`Etapa ${stage.name}`} className="w-72 shrink-0 snap-start rounded-[var(--radius-panel)] border bg-[var(--surface-subtle)] p-3" key={stage.id}><header className="mb-3 flex items-center justify-between gap-2"><h2><span className="stage-badge">{stage.name}</span></h2><span aria-label={`${stage.count} oportunidades nesta etapa`} className="rounded bg-background px-2 py-1 text-xs font-semibold">{stage.count}</span></header><div className="space-y-3">{stage.opportunities.map((opportunity) => <div key={opportunity.id}><OpportunityRow opportunity={opportunity} timeZone={screen.timeZone} />{opportunity.canWrite && opportunity.status === "OPEN" ? <Button className="mt-2 w-full" onClick={() => setSelectedId(opportunity.id)} size="sm" type="button" variant="secondary">Alterar etapa</Button> : null}</div>)}{stage.count === 0 ? <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">Etapa vazia neste recorte.</p> : null}</div></section>)}</section>
      ) : (
        <DataTableShell><table className="w-full min-w-[1000px] text-left text-sm"><thead className="sticky top-0 z-10 border-b bg-muted"><tr><th className="p-3">Oportunidade</th><th className="p-3">Lead</th><th className="p-3">Closer</th><th className="p-3">Produto</th><th className="p-3">Etapa</th><th className="p-3">Valor</th><th className="p-3">Próxima ação</th><th className="p-3">Ação</th></tr></thead><tbody>{opportunities.map((opportunity) => <tr className="border-b last:border-0" key={opportunity.id}><td className="p-3 font-medium">{opportunity.name}</td><td className="p-3">{opportunity.leadName}</td><td className="p-3">{opportunity.ownerName}</td><td className="p-3">{opportunity.productName ?? opportunity.interestDescription ?? "Ausente"}</td><td className="p-3"><span className="stage-badge">{opportunity.stageName}</span></td><td className="p-3">{money(opportunity.amountCents)}</td><td className="p-3">{opportunity.nextActionDescription ?? "Encerrada"}</td><td className="p-3">{opportunity.canWrite && opportunity.status === "OPEN" ? <Button onClick={() => setSelectedId(opportunity.id)} size="sm" type="button" variant="secondary">Trabalhar oportunidade</Button> : "Somente leitura"}</td></tr>)}</tbody></table></DataTableShell>
      )}

      {selected ? (
        <AccessibleDialog
          busy={pending}
          className="max-w-2xl space-y-5"
          labelledBy="opportunity-transition-title"
          onDismiss={() => setSelectedId(null)}
        >
          <div>
            <h2 className="text-xl font-bold" id="opportunity-transition-title">Trabalhar {selected.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Lead: {selected.leadName} · etapa atual: {selected.stageName}</p>
          </div>
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
          <form className="grid gap-3 rounded-md border p-4" onSubmit={transition}>
            <h3 className="font-semibold">Alterar etapa</h3>
            <label className="text-sm">Destino<select className={inputClass} name="targetStageId" required><option value="">Selecione</option>{selected.transitions.filter((item) => item.code !== "PROPOSAL").map((item) => <option disabled={!item.allowed} key={item.stageId} value={item.stageId}>{item.name}{item.blockReason ? ` — ${item.blockReason}` : ""}</option>)}</select></label>
            <label className="text-sm">Motivo<textarea className={inputClass} name="reason" required /></label>
            <label className="text-sm">Motivo de perda<select className={inputClass} name="lossReasonId"><option value="">Não se aplica</option>{screen.lossReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
            <label className="text-sm">Nova próxima ação opcional<input className={inputClass} name="nextActionTitle" /></label>
            <label className="text-sm">Prazo opcional<input className={inputClass} name="nextActionDueAt" type="datetime-local" /></label>
            <label className="flex gap-2 text-sm"><input name="confirmed" type="checkbox" /> Confirmo quando a transição for sensível.</label>
            <Button disabled={pending} type="submit">Confirmar transição</Button>
          </form>
          <div className="flex justify-end"><Button disabled={pending} onClick={() => setSelectedId(null)} type="button" variant="secondary">Fechar</Button></div>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
