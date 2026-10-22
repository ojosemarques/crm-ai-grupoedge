"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { completeLeadSaleSchema, directSaleInstallmentCount, type CompleteLeadSaleResult, type directSalePaymentPlans, type salePaymentMethods } from "@/modules/opportunities/domain/sale-completion-contracts";
import type { LeadOpportunityScreen, OpportunityListItem } from "@/modules/opportunities/domain/opportunity-contracts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
type PaymentPlan = (typeof directSalePaymentPlans)[number];

export type PreparedSaleTerms = Readonly<{
  description: string;
  totalCents: string;
  upfrontCents: string;
  monthlyCents: string;
  durationMonths: number;
  paymentMethod: (typeof salePaymentMethods)[number];
  paymentCondition: string;
}>;

function cents(value: string) {
  const raw = value.trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}

function reais(value: string) {
  const amount = BigInt(value);
  return `${amount / 100n},${(amount % 100n).toString().padStart(2, "0")}`;
}

function money(value: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}

export function LeadSalePanel({ screen, opportunity, onCommitted, onBusyChange }: Readonly<{
  screen: LeadOpportunityScreen;
  opportunity: OpportunityListItem | null;
  onCommitted: () => void;
  onBusyChange: (busy: boolean) => void;
}>) {
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>("UPFRONT_INSTALLMENTS");
  const [total, setTotal] = useState(opportunity ? reais(opportunity.tcvCents) : "");
  const [upfront, setUpfront] = useState("0,00");
  const [installmentValue, setInstallmentValue] = useState(opportunity ? reais(opportunity.mrrCents) : "0,00");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompleteLeadSaleResult | null>(null);
  const idempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const amounts = { totalCents: cents(total) ?? "", upfrontCents: cents(upfront) ?? "", installmentCents: cents(installmentValue) ?? "", paymentPlan };
  const installmentCount = directSaleInstallmentCount(amounts);

  function changePlan(next: PaymentPlan) {
    setPaymentPlan(next);
    if (next === "CASH") {
      setUpfront(total || "0,00");
      setInstallmentValue("0,00");
    } else if (paymentPlan === "CASH") setUpfront("0,00");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const command = {
      leadId: screen.leadId,
      ...(opportunity ? { opportunityId: opportunity.id, expectedRevision: opportunity.revision } : {}),
      sellerMemberId: form.get("sellerMemberId"),
      ...amounts,
      paymentCondition: form.get("paymentCondition"),
      confirmed: true,
    };
    const fingerprint = JSON.stringify(command);
    if (idempotency.current?.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: crypto.randomUUID() };
    setError(null);
    const payload = completeLeadSaleSchema.safeParse({ ...command, idempotencyKey: idempotency.current.key });
    if (!payload.success) {
      setError(payload.error.issues[0]?.message ?? "Revise os dados da venda.");
      return;
    }
    setPending(true); onBusyChange(true);
    try {
      const response = await fetch("/api/opportunities/close-sale", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "COMPLETE_LEAD", payload: payload.data }),
      });
      const body = await response.json() as { result?: CompleteLeadSaleResult; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível registrar a venda.");
      setCompleted(body.result);
      onCommitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a venda.");
    } finally {
      setPending(false); onBusyChange(false);
    }
  }

  if (completed) return <section className="rounded-md border border-emerald-300 bg-emerald-50 p-4" aria-label="Resultado da venda">
    <p className="font-semibold" role="status">Venda registrada. Condições comerciais salvas.</p>
  </section>;

  return <section className="space-y-4 rounded-md border p-4" aria-label="Registrar venda do lead">
    <p className="text-sm text-muted-foreground">SISTEMA POLITIZAI. Preencha uma única vez e confirme a venda.</p>
    {error ? <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <fieldset className="contents" disabled={pending}>
        <label className="text-sm">Vendedor<select className={inputClass} defaultValue={opportunity?.ownerMemberId ?? screen.suggestedSaleSellerId ?? ""} name="sellerMemberId" required><option value="">Selecione</option>{screen.saleSellerOptions.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
        <label className="text-sm">Valor total (R$)<input className={inputClass} inputMode="decimal" onChange={(event) => { setTotal(event.target.value); if (paymentPlan === "CASH") setUpfront(event.target.value); }} required value={total} /></label>
        <label className="text-sm">Condição de pagamento<select className={inputClass} onChange={(event) => changePlan(event.target.value as PaymentPlan)} value={paymentPlan}><option value="UPFRONT_INSTALLMENTS">Entrada + parcelas</option><option value="CASH">Valor total à vista</option><option value="CARD_INSTALLMENTS">Cartão: entrada + parcelas</option></select></label>
        <label className="text-sm">Valor de cada parcela (R$)<input className={inputClass} inputMode="decimal" onChange={(event) => setInstallmentValue(event.target.value)} readOnly={paymentPlan === "CASH"} required value={installmentValue} /></label>
        <label className="text-sm">Entrada (R$)<input className={inputClass} inputMode="decimal" onChange={(event) => setUpfront(event.target.value)} readOnly={paymentPlan === "CASH"} required value={upfront} /></label>
        <label className="text-sm sm:col-span-2">Condição de pagamento detalhada<textarea className={inputClass} minLength={2} maxLength={500} name="paymentCondition" required /></label>
      </fieldset>
      {installmentCount !== null ? <p className="rounded-md border p-3 text-sm sm:col-span-2" role="status">{paymentPlan === "CASH" ? `À vista: ${money(amounts.totalCents)}.` : `Entrada de ${money(amounts.upfrontCents)} + ${installmentCount} parcelas de ${money(amounts.installmentCents)}. Total: ${money(amounts.totalCents)}.`}</p> : <p className="text-sm text-muted-foreground sm:col-span-2">O saldo após a entrada dividido pelo valor da parcela deve resultar em 1 a 60 parcelas inteiras, sem diferença no total.</p>}
      <Button className="sm:col-span-2" disabled={pending || installmentCount === null} type="submit">{pending ? "Registrando…" : "Confirmar e marcar vendido"}</Button>
    </form>
  </section>;
}
