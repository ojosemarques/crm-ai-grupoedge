"use client";

import { FormEvent, useState } from "react";

import styles from "./lead-detail.module.css";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { SalesGatesPanel } from "@/components/opportunities/sales-gates-panel";
import type {
  LeadOpportunityScreen,
  OpportunityListItem,
} from "@/modules/opportunities/domain/opportunity-contracts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

function formatMoney(cents: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(cents) / 100);
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "Não informada";
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
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Informe um valor monetário válido em reais.");
  return String(Math.round(amount * 100));
}

async function resultFrom(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; result?: unknown };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a operação.");
  return body.result;
}

function optionalNextAction(form: FormData) {
  const title = String(form.get("nextActionTitle") ?? "").trim();
  const dueAtLocal = String(form.get("nextActionDueAt") ?? "").trim();
  if (!title && !dueAtLocal) return undefined;
  if (!title || !dueAtLocal) throw new Error("Informe título e prazo da próxima ação.");
  return { title, dueAtLocal };
}

function OpportunityActions({
  opportunity,
  screen,
  pending,
  run,
}: Readonly<{
  opportunity: OpportunityListItem;
  screen: LeadOpportunityScreen;
  pending: boolean;
  run: (body: Record<string, unknown>, success: string) => Promise<void>;
}>) {
  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run({
      action: "TRANSITION",
      targetStageId: String(form.get("targetStageId") ?? ""),
      expectedRevision: opportunity.revision,
      reason: String(form.get("reason") ?? ""),
      origin: "OPPORTUNITY_CARD",
      confirmed: form.get("confirmed") === "on",
      lossReasonId: String(form.get("lossReasonId") ?? "") || null,
      nextAction: optionalNextAction(form),
    }, "Etapa comercial atualizada.");
  }

  async function proposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run({
      action: "PROPOSAL",
      expectedRevision: opportunity.revision,
      productId: String(form.get("productId") ?? ""),
      offerTemplateId: String(form.get("offerTemplateId") ?? "") || null,
      name: String(form.get("name") ?? ""),
      quantity: Number(form.get("quantity")),
      unitPriceCents: reaisToCents(form.get("unitPrice")),
      discountCents: reaisToCents(form.get("discount")),
      validUntilDate: String(form.get("validUntilDate") ?? "") || undefined,
      justification: String(form.get("justification") ?? "").trim() || undefined,
      confirmed: form.get("confirmed") === "on",
      nextAction: optionalNextAction(form),
    }, "Proposta registrada e adicionada à timeline.");
  }

  async function reopen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run({
      action: "REOPEN",
      expectedRevision: opportunity.revision,
      reason: String(form.get("reason") ?? ""),
      confirmed: form.get("confirmed") === "on",
      nextAction: optionalNextAction(form),
    }, "Oportunidade reaberta em Negociação.");
  }

  if (!opportunity.canWrite) {
    return <p className="mt-4 rounded border border-dashed p-3 text-sm text-muted-foreground">Somente leitura para seu perfil.</p>;
  }

  if (opportunity.status !== "OPEN") {
    return opportunity.canReopen ? (
      <form className="mt-4 grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4" onSubmit={reopen}>
        <h4 className="font-semibold text-amber-950">Reabrir oportunidade</h4>
        <label className="text-sm">Motivo<textarea className={inputClass} name="reason" required /></label>
        <label className="text-sm">Próxima ação<input className={inputClass} name="nextActionTitle" required /></label>
        <label className="text-sm">Prazo<input className={inputClass} name="nextActionDueAt" required type="datetime-local" /></label>
        <label className="flex gap-2 text-sm"><input name="confirmed" required type="checkbox" /> Confirmo a reabertura gerencial.</label>
        <Button disabled={pending} type="submit">Reabrir em Negociação</Button>
      </form>
    ) : null;
  }

  return (
    <details className={styles.actionForm}><summary><Icon name="configuracoes" size={14} />Gerenciar negócio e propostas</summary><div className="mt-4 grid gap-4">
      {(opportunity.stageCode === "OPPORTUNITY_CONFIRMED" || opportunity.stageCode === "PROPOSAL") ? (
        <form className="grid gap-3 rounded-md border p-4" onSubmit={proposal}>
          <h4 className="font-semibold">Registrar proposta</h4>
          <label className="text-sm">Produto<select className={inputClass} defaultValue={opportunity.productId ?? ""} name="productId" required><option value="">Selecione</option>{screen.productOptions.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <label className="text-sm">Oferta/plano<select className={inputClass} name="offerTemplateId"><option value="">Sem modelo</option>{screen.offerTemplateOptions.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <label className="text-sm">Nome da proposta<input className={inputClass} name="name" required /></label>
          <div className="grid grid-cols-3 gap-2"><label className="text-sm">Quantidade<input className={inputClass} defaultValue="1" min="1" name="quantity" type="number" /></label><label className="text-sm">Valor unitário (R$)<input className={inputClass} inputMode="decimal" name="unitPrice" placeholder="3500,00" required /></label><label className="text-sm">Desconto (R$)<input className={inputClass} defaultValue="0" inputMode="decimal" name="discount" /></label></div>
          <label className="text-sm">Validade<input className={inputClass} name="validUntilDate" type="date" /></label>
          <label className="text-sm">Justificativa para valor zero<textarea className={inputClass} name="justification" /></label>
          <label className="text-sm">Próxima ação opcional<input className={inputClass} name="nextActionTitle" /></label>
          <label className="text-sm">Prazo opcional<input className={inputClass} name="nextActionDueAt" type="datetime-local" /></label>
          <label className="flex gap-2 text-sm"><input name="confirmed" required type="checkbox" /> Confirmo o envio/registro desta proposta.</label>
          <Button disabled={pending} type="submit">Registrar proposta</Button>
        </form>
      ) : null}

      <form className="grid gap-3 rounded-md border p-4" onSubmit={transition}>
        <h4 className="font-semibold">Alterar etapa</h4>
        <label className="text-sm">Destino<select className={inputClass} name="targetStageId" required><option value="">Selecione</option>{opportunity.transitions.filter((item) => item.code !== "PROPOSAL").map((item) => <option disabled={!item.allowed} key={item.stageId} value={item.stageId}>{item.name}{item.blockReason ? ` — ${item.blockReason}` : ""}</option>)}</select></label>
        <label className="text-sm">Motivo<textarea className={inputClass} name="reason" required /></label>
        <label className="text-sm">Motivo de perda<select className={inputClass} name="lossReasonId"><option value="">Não se aplica</option>{screen.lossReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
        <label className="text-sm">Nova próxima ação opcional<input className={inputClass} name="nextActionTitle" /></label>
        <label className="text-sm">Prazo opcional<input className={inputClass} name="nextActionDueAt" type="datetime-local" /></label>
        <label className="flex gap-2 text-sm"><input name="confirmed" type="checkbox" /> Confirmo quando a transição for sensível.</label>
        <Button disabled={pending || opportunity.transitions.length === 0} type="submit">Confirmar transição</Button>
      </form>
    </div></details>
  );
}

export function LeadOpportunitiesWorkspace({
  initialScreen,
  onCommitted,
}: Readonly<{
  initialScreen: LeadOpportunityScreen;
  onCommitted: () => void;
}>) {
  const [screen, setScreen] = useState(initialScreen);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);

  async function refresh() {
    const response = await fetch(`/api/leads/${screen.leadId}/opportunities`, { cache: "no-store" });
    const result = await resultFrom(response) as LeadOpportunityScreen;
    setScreen(result);
  }

  async function runOpportunity(opportunityId: string, body: Record<string, unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await resultFrom(await fetch(`/api/opportunities/${opportunityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      await refresh();
      setNotice({ kind: "success", message: success });
      onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function createOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setNotice(null);
    try {
      await resultFrom(await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: screen.leadId,
          accountId: String(form.get("accountId") ?? "") || null,
          meetingId: String(form.get("meetingId") ?? ""),
          ownerMemberId: String(form.get("ownerMemberId") ?? ""),
          productId: String(form.get("productId") ?? "") || null,
          interestDescription: String(form.get("interestDescription") ?? "").trim() || undefined,
          name: String(form.get("name") ?? ""),
          amountCents: reaisToCents(form.get("amount")),
          mrrCents: reaisToCents(form.get("mrr")),
          tcvCents: reaisToCents(form.get("tcv")),
          probabilityPercent: Number(form.get("probabilityPercent")),
          expectedCloseDate: String(form.get("expectedCloseDate") ?? "") || undefined,
          notes: String(form.get("notes") ?? "").trim() || undefined,
          nextAction: {
            title: String(form.get("nextActionTitle") ?? ""),
            dueAtLocal: String(form.get("nextActionDueAt") ?? ""),
          },
        }),
      }));
      formElement.reset();
      await refresh();
      setNotice({ kind: "success", message: "Oportunidade criada e vinculada à reunião." });
      onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  if (!screen.canRead) {
    return <section className="rounded-lg border border-dashed p-6"><h2 className="font-semibold">Sem permissão para oportunidades</h2><p className="mt-2 text-sm text-muted-foreground">Seu acesso ao lead continua disponível, mas os dados comerciais do closer não fazem parte do seu escopo.</p></section>;
  }

  return (
    <section aria-labelledby="opportunities-title" className="space-y-5">
      <div className={styles.dealHeading}><Icon name="vendas" size={20} /><div><h2 id="opportunities-title">Negócios de {screen.leadName}</h2><p>{screen.opportunities.length} oportunidades vinculadas</p></div></div>
      {notice ? <p className={`rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}

      {screen.canCreate ? (
        <details className={styles.actionForm}><summary><Icon name="mais" size={15} /> Novo negócio</summary><form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={createOpportunity}>
          <label className="text-sm">Reunião vinculada<select className={inputClass} name="meetingId" required><option value="">Selecione</option>{screen.meetingOptions.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title} · {meeting.status} · {formatDate(meeting.startsAt, screen.timeZone)}</option>)}</select></label>
          <label className="text-sm">Closer responsável<select className={inputClass} name="ownerMemberId" required><option value="">Selecione</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label>
          <label className="text-sm md:col-span-2">Conta vinculada<select className={inputClass} defaultValue={screen.suggestedAccountId ?? ""} name="accountId"><option value="">Sem conta canônica — manter para revisão</option>{screen.accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="text-sm">Nome<input className={inputClass} name="name" required /></label>
          <label className="text-sm">Produto<select className={inputClass} name="productId"><option value="">Ainda não definido</option>{screen.productOptions.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.listPriceCents)}</option>)}</select></label>
          <label className="text-sm md:col-span-2">Interesse, quando o produto ainda não estiver definido<textarea className={inputClass} name="interestDescription" /></label>
          <label className="text-sm">Valor estimado (R$)<input className={inputClass} defaultValue="0" inputMode="decimal" name="amount" /></label>
          <label className="text-sm">MRR (R$)<input className={inputClass} defaultValue="0" inputMode="decimal" name="mrr" /></label>
          <label className="text-sm">TCV (R$)<input className={inputClass} defaultValue="0" inputMode="decimal" name="tcv" /></label>
          <label className="text-sm">Probabilidade manual (%)<input className={inputClass} defaultValue="50" max="100" min="0" name="probabilityPercent" type="number" /></label>
          <label className="text-sm">Fechamento previsto<input className={inputClass} name="expectedCloseDate" type="date" /></label>
          <label className="text-sm">Próxima ação<input className={inputClass} name="nextActionTitle" required /></label>
          <label className="text-sm">Prazo da próxima ação<input className={inputClass} name="nextActionDueAt" required type="datetime-local" /></label>
          <label className="text-sm md:col-span-2">Notas<textarea className={inputClass} name="notes" /></label>
          <Button className="md:col-span-2" disabled={pending} type="submit">{pending ? "Salvando…" : "Criar oportunidade"}</Button>
        </form></details>
      ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Para criar uma oportunidade, seu perfil precisa de escrita e o lead deve possuir reunião elegível e closer disponível.</p>}

      {screen.opportunities.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma oportunidade registrada para este lead.</p> : (
        <div className="space-y-5">{screen.opportunities.map((opportunity) => (
          <article className={styles.dealCard} key={opportunity.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{opportunity.name}</h3><p className="text-sm text-muted-foreground">{opportunity.stageName} · {opportunity.ownerName}{opportunity.accountName ? ` · ${opportunity.accountName}` : " · conta não vinculada"}</p></div><span className="rounded-full border px-3 py-1 text-xs">{opportunity.status}</span></div>
            <dl className={styles.dealStats}><div><dt className="text-muted-foreground">Produto/interesse</dt><dd>{opportunity.productName ?? opportunity.interestDescription ?? "Ausente"}</dd></div><div><dt className="text-muted-foreground">Valor estimado</dt><dd>{formatMoney(opportunity.amountCents)}</dd></div><div><dt className="text-muted-foreground">MRR / TCV</dt><dd>{formatMoney(opportunity.mrrCents)} / {formatMoney(opportunity.tcvCents)}</dd></div><div><dt className="text-muted-foreground">Probabilidade</dt><dd>{opportunity.probabilityPercent}% manual</dd></div><div><dt className="text-muted-foreground">Próxima ação</dt><dd>{opportunity.nextActionDescription ?? "Encerrada"} · {formatDate(opportunity.nextActionAt, screen.timeZone)}</dd></div><div><dt className="text-muted-foreground">Fechamento previsto</dt><dd>{formatDate(opportunity.expectedCloseAt, screen.timeZone)}</dd></div><div><dt className="text-muted-foreground">Motivo de perda</dt><dd>{opportunity.lossReasonName ?? "Não se aplica"}</dd></div></dl>
            <SalesGatesPanel opportunityId={opportunity.id} onCommitted={onCommitted} />
            {opportunity.offers.length > 0 ? <div className="mt-4"><h4 className="text-sm font-semibold">Propostas</h4><ul className="mt-2 space-y-2">{opportunity.offers.map((offer) => <li className="rounded border p-3 text-sm" key={offer.id}><strong>{offer.name}</strong> · {formatMoney(offer.totalCents)}{offer.acceptedAt ? " · aceita no ganho" : ""}{offer.lines.length ? <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{offer.lines.map((line) => <li key={`${offer.id}:${line.revenueCategory}:${line.productName}`}>{line.revenueCategory} · {line.productName} v{line.productVersion} · {formatMoney(line.totalCents)}</li>)}</ul> : <span> · {offer.productName}</span>}</li>)}</ul></div> : null}
            <OpportunityActions opportunity={opportunity} pending={pending} run={(body, success) => runOpportunity(opportunity.id, body, success)} screen={screen} />
          </article>
        ))}</div>
      )}
    </section>
  );
}
