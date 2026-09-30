"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { OpportunityListItem } from "@/modules/opportunities/domain/opportunity-contracts";
import { saleCompletionSchema, type SaleCompletionInput } from "@/modules/opportunities/domain/sale-completion-contracts";

type Template = { id: string; name: string; version: number };
type Preview = { payload: SaleCompletionInput; customer: { mode: "CREATE" | "LINK" | "EXISTING"; name: string; accountId: string | null }; customerName: string; sellerName: string; contractTemplateName: string; schedule: Array<{ installment: number; amountCents: string; dueAt: string }>; pendingSteps: string[]; summary: string };
type Completed = { accountId: string; contractId: string; invoiceIds: string[]; subscriptionId: string | null; handoffId: string | null; pendingSteps: string[] };
const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

function reais(value: string) {
  const amount = BigInt(value);
  return `${amount / 100n},${(amount % 100n).toString().padStart(2, "0")}`;
}
function currency(value: string) {
  const amount = BigInt(value);
  return `R$ ${new Intl.NumberFormat("pt-BR").format(amount / 100n)},${(amount % 100n).toString().padStart(2, "0")}`;
}
function cents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Informe valores em reais com até duas casas decimais.");
  const [whole = "0", fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
async function result<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.result) throw new Error(body?.error?.message ?? "Não foi possível concluir a solicitação. Tente novamente.");
  return body.result;
}

export function SaleCompletionPanel({ opportunity, sellers, initiallyExpanded = false, onBusyChange, onCommitted }: Readonly<{
  opportunity: OpportunityListItem;
  sellers: readonly { id: string; name: string }[];
  initiallyExpanded?: boolean;
  onBusyChange: (busy: boolean) => void;
  onCommitted: () => void;
}>) {
  const titleId = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [customerMode, setCustomerMode] = useState("LINKED");
  const [accountSearch, setAccountSearch] = useState("");
  const [loading, setLoading] = useState(initiallyExpanded);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ data: Preview; idempotencyKey: string } | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    async function load() {
      try {
        const data = await result<{ templateVersions: Template[] }>(await fetch("/api/contracts", { cache: "no-store" }));
        if (active) setTemplates(data.templateVersions);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Falha ao carregar modelos contratuais."); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [expanded, reload]);

  function open() {
    setExpanded(true); setLoading(true); setError(null); setReload((value) => value + 1);
  }

  async function searchAccounts() {
    setBusy(true); onBusyChange(true); setError(null);
    try {
      const data = await result<{ items: Array<{ id: string; name: string }> }>(await fetch(`/api/accounts?status=ACTIVE&pageSize=100&search=${encodeURIComponent(accountSearch)}`, { cache: "no-store" }));
      setAccounts(data.items);
      if (!data.items.length) setError("Nenhum cliente encontrado. Revise a busca ou confirme um novo cadastro.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao buscar clientes."); }
    finally { setBusy(false); onBusyChange(false); }
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null); setPreview(null);
    try {
      const payload = saleCompletionSchema.safeParse({
        opportunityId: opportunity.id, expectedRevision: opportunity.revision,
        sellerMemberId: form.get("sellerMemberId"), totalCents: cents(form.get("total")),
        monthlyCents: cents(form.get("monthly")), upfrontCents: cents(form.get("upfront")),
        durationMonths: Number(form.get("months")), startsAt: new Date(`${String(form.get("startsAt"))}T00:00:00.000Z`).toISOString(),
        templateVersionId: form.get("templateVersionId"),
        ...(!opportunity.accountId && customerMode === "CREATE" ? { customer: { mode: "CREATE", name: form.get("customerName") } } : {}),
        ...(!opportunity.accountId && customerMode === "LINK" ? { customer: { mode: "LINK", accountId: form.get("accountId") } } : {}),
        ...(accepted ? { acceptance: { acceptedByName: form.get("acceptedByName"), acceptedByRole: form.get("acceptedByRole"), evidenceText: form.get("evidenceText") } } : {}),
        ...(accepted && form.get("onboardingOwnerMemberId") ? { onboardingOwnerMemberId: form.get("onboardingOwnerMemberId") } : {}),
      });
      if (!payload.success) throw new Error(payload.error.issues[0]?.message ?? "Revise as condições da venda.");
      setBusy(true); onBusyChange(true);
      const data = await result<Preview>(await fetch("/api/opportunities/close-sale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "PREVIEW", payload: payload.data }) }));
      setPreview({ data, idempotencyKey: crypto.randomUUID() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao preparar o fechamento."); }
    finally { setBusy(false); onBusyChange(false); }
  }

  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setBusy(true); onBusyChange(true); setError(null);
    try {
      const data = await result<Completed>(await fetch("/api/opportunities/close-sale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "EXECUTE", payload: { ...preview.data.payload, confirmed: true, idempotencyKey: preview.idempotencyKey } }) }));
      setCompleted(data); onCommitted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao concluir. Tente novamente com esta mesma prévia."); }
    finally { setBusy(false); onBusyChange(false); }
  }

  if (completed) return <section className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50/30 p-4" aria-label="Resultado do fechamento integrado">
    <h3 className="font-semibold" role="status">Venda registrada</h3>
    <p className="text-sm">Contrato gerado{completed.invoiceIds.length ? ` e ${completed.invoiceIds.length} recebível(is) emitido(s)` : " em rascunho"}. Nenhum recebimento foi confirmado automaticamente.</p>
    <ul className="list-disc space-y-1 pl-5 text-sm">{completed.pendingSteps.map((step) => <li key={step}>{step}</li>)}</ul>
    <nav aria-label="Resultados da venda" className="flex flex-wrap gap-4 text-sm underline"><Link href={`/contas/${completed.accountId}`}>Ver cliente</Link><Link href="/contratos">Ver contratos</Link><Link href="/financeiro?section=pagar-receber">Ver financeiro</Link>{completed.handoffId ? <Link href="/onboarding">Ver onboarding</Link> : null}</nav>
  </section>;
  if (!opportunity.canWrite || opportunity.status !== "OPEN") return null;

  return <section className="space-y-4 rounded-md border p-4" aria-labelledby={titleId}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 id={titleId} className="font-semibold">Fechar venda integrada</h3><p className="mt-1 text-sm text-muted-foreground">Contrato, comissão e pós-venda conectados às condições confirmadas.</p></div>{!expanded ? <Button onClick={open} type="button" variant="secondary" aria-expanded={false}>Preparar fechamento</Button> : null}</header>
    {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
    {expanded ? <>
      {loading ? <p role="status" className="text-sm">Carregando modelos contratuais…</p> : !templates.length ? <div className="space-y-2 text-sm"><p>Nenhum modelo contratual disponível para este acesso.</p><Link className="underline" href="/contratos">Ver contratos e modelos</Link><Button onClick={() => void open()} type="button" size="sm" variant="secondary">Recarregar modelos</Button></div> : null}
      <form onSubmit={prepare}>
        <fieldset disabled={busy || loading || preview !== null || !templates.length} className="grid gap-3 sm:grid-cols-2">
          {opportunity.accountId ? <p className="text-sm sm:col-span-2">Cliente vinculado: <strong>{opportunity.accountName}</strong>. A venda e os recebíveis aparecerão neste cadastro.</p> : <>
            <label className="text-sm sm:col-span-2">Cadastro do cliente<select className={inputClass} value={customerMode} onChange={(event) => setCustomerMode(event.target.value)}><option value="LINKED">Usar o cliente já vinculado ao lead</option><option value="LINK">Selecionar cliente existente</option><option value="CREATE">Cadastrar novo cliente</option></select></label>
            {customerMode === "CREATE" ? <label className="text-sm sm:col-span-2">Nome confirmado do cliente<input className={inputClass} name="customerName" minLength={2} maxLength={200} required placeholder="Informe o nome real da pessoa ou organização contratante" /><span className="mt-1 block text-xs text-muted-foreground">O cadastro será criado somente após revisar e confirmar o fechamento.</span></label> : null}
            {customerMode === "LINK" ? <>
              <label className="text-sm">Buscar cliente<input className={inputClass} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Nome do cliente" /></label><div className="self-end"><Button type="button" variant="secondary" onClick={() => void searchAccounts()}>Buscar clientes</Button></div>
              <label className="text-sm sm:col-span-2">Cliente existente<select className={inputClass} name="accountId" required defaultValue=""><option value="">Selecione após buscar</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            </> : null}
          </>}
          <label className="text-sm">Vendedor<select className={inputClass} name="sellerMemberId" defaultValue={opportunity.ownerMemberId} required>{sellers.some((seller) => seller.id === opportunity.ownerMemberId) ? null : <option value={opportunity.ownerMemberId}>{opportunity.ownerName}</option>}{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
          <label className="text-sm">Modelo de contrato<select className={inputClass} name="templateVersionId" required defaultValue=""><option value="">Selecione</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select></label>
          <label className="text-sm">Total do contrato (R$)<input className={inputClass} name="total" inputMode="decimal" defaultValue={reais(opportunity.offers[0]?.totalCents ?? opportunity.tcvCents)} required /></label>
          <label className="text-sm">Entrada (R$)<input className={inputClass} name="upfront" inputMode="decimal" defaultValue="0,00" required /></label>
          <label className="text-sm">Mensalidade (R$)<input className={inputClass} name="monthly" inputMode="decimal" defaultValue={reais(opportunity.mrrCents)} required /></label>
          <label className="text-sm">Quantidade de meses<input className={inputClass} name="months" type="number" min="1" max="60" defaultValue="1" required /></label>
          <label className="text-sm">Início de vigência<input className={inputClass} name="startsAt" type="date" required /></label>
          <p className="self-end text-sm text-muted-foreground">Total = entrada + mensalidade × meses. Para venda avulsa, informe o total na entrada, mensalidade zero e um mês.</p>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> Já existe aceite real do cliente, com evidência para registrar.</label>
          {accepted ? <>
            <label className="text-sm">Quem aceitou<input className={inputClass} name="acceptedByName" minLength={2} maxLength={200} required /></label>
            <label className="text-sm">Cargo ou papel de quem aceitou<input className={inputClass} name="acceptedByRole" minLength={2} maxLength={200} required /></label>
            <label className="text-sm sm:col-span-2">Evidência do aceite<textarea className={inputClass} name="evidenceText" minLength={5} maxLength={2000} required placeholder="Descreva o aceite efetivamente recebido e sua referência." /></label>
            <label className="text-sm">Responsável pelo onboarding (opcional)<select className={inputClass} name="onboardingOwnerMemberId" defaultValue=""><option value="">Definir depois</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
          </> : <p className="text-sm text-muted-foreground sm:col-span-2">Sem aceite registrado, o contrato fica em rascunho. Recebíveis e assinatura dependem desse aceite.</p>}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy || preview !== null}>{busy ? "Processando…" : "Revisar fechamento"}</Button></div>
        </fieldset>
      </form>
      {preview ? <div className="space-y-3 rounded-md border bg-muted/20 p-4">
        <h4 className="font-semibold">Revise antes de confirmar</h4>
        <p className="text-sm">{preview.data.customerName} · vendedor {preview.data.sellerName} · {preview.data.contractTemplateName}</p>
        <p className="text-sm">{preview.data.customer.mode === "CREATE" ? "Será criado um cadastro para este cliente." : preview.data.customer.mode === "LINK" ? "A venda será vinculada ao cadastro existente do cliente." : "O cadastro atual do cliente será utilizado."}</p>
        <p className="text-sm">{preview.data.summary}</p>
        <p className="text-sm font-medium">Total {currency(preview.data.payload.totalCents)} · entrada {currency(preview.data.payload.upfrontCents)} · {preview.data.payload.durationMonths} mensalidade(s) de {currency(preview.data.payload.monthlyCents)}</p>
        <div className="max-h-60 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>{preview.data.schedule.map((item) => <tr key={item.installment} className="border-t"><td className="py-2">{item.installment}</td><td>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(item.dueAt))}</td><td>{currency(item.amountCents)}</td></tr>)}</tbody></table></div>
        <p className="text-xs text-muted-foreground">A primeira parcela inclui a entrada e a primeira mensalidade. Pagamentos serão confirmados somente após o recebimento.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{preview.data.pendingSteps.map((step) => <li key={step}>{step}</li>)}</ul>
        <form onSubmit={execute} className="space-y-3"><label className="flex gap-2 text-sm"><input type="checkbox" required disabled={busy} /> Revisei os dados e confirmo este fechamento.</label><div className="flex flex-wrap gap-2"><Button disabled={busy} type="submit">{busy ? "Registrando…" : "Confirmar fechamento integrado"}</Button><Button disabled={busy} type="button" variant="secondary" onClick={() => { setPreview(null); setError(null); }}>Editar condições</Button></div></form>
      </div> : null}
    </> : null}
  </section>;
}
