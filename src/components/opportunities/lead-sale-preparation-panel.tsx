"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { prepareLeadSaleSchema, salePaymentMethods, type PrepareLeadSaleInput } from "@/modules/opportunities/domain/sale-completion-contracts";
import type { LeadOpportunityScreen } from "@/modules/opportunities/domain/opportunity-contracts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
type PaymentMethod = (typeof salePaymentMethods)[number];

export type PreparedSaleTerms = Readonly<{
  description: string;
  totalCents: string;
  upfrontCents: string;
  monthlyCents: string;
  durationMonths: number;
  paymentMethod: PaymentMethod;
  paymentCondition: string;
}>;

function cents(value: string) {
  const raw = value.trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function money(value: bigint) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}

async function result<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.result) throw new Error(body?.error?.message ?? "Não foi possível preparar o fechamento.");
  return body.result;
}

function condition(input: Pick<PrepareLeadSaleInput, "paymentPlan" | "paymentMethod" | "upfrontCents" | "installmentCents" | "installmentCount">) {
  const method = { PIX: "PIX", BANK_TRANSFER: "transferência bancária", CARD: "cartão", CASH: "dinheiro", OTHER: "outro meio" }[input.paymentMethod];
  if (input.paymentPlan === "CASH") return `À vista, ${money(BigInt(input.upfrontCents))}, via ${method}.`;
  if (input.paymentPlan === "INSTALLMENTS") return `${input.installmentCount} parcela(s) de ${money(BigInt(input.installmentCents))}, sem entrada, via ${method}.`;
  return `Entrada de ${money(BigInt(input.upfrontCents))} + ${input.installmentCount} parcela(s) de ${money(BigInt(input.installmentCents))}, via ${method}.`;
}

export function LeadSalePreparationPanel({ screen, onPrepared }: Readonly<{
  screen: LeadOpportunityScreen;
  onPrepared: (opportunityId: string, terms: PreparedSaleTerms) => Promise<void>;
}>) {
  const [paymentPlan, setPaymentPlan] = useState<PrepareLeadSaleInput["paymentPlan"]>("UPFRONT_INSTALLMENTS");
  const [total, setTotal] = useState("");
  const [upfront, setUpfront] = useState("0,00");
  const [installments, setInstallments] = useState("1");
  const [installmentValue, setInstallmentValue] = useState("0,00");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const reconciliation = useMemo(() => {
    const totalCents = cents(total);
    const upfrontCents = cents(upfront);
    const installmentCents = cents(installmentValue);
    const count = Number(installments);
    if (totalCents === null || upfrontCents === null || installmentCents === null || !Number.isInteger(count) || count < 1) return null;
    const composed = upfrontCents + installmentCents * BigInt(count);
    return { totalCents, composed, difference: totalCents - composed };
  }, [installmentValue, installments, total, upfront]);

  function changePlan(next: PrepareLeadSaleInput["paymentPlan"]) {
    setPaymentPlan(next);
    if (next === "CASH") {
      setUpfront(total || "0,00");
      setInstallments("1");
      setInstallmentValue("0,00");
    } else if (next === "INSTALLMENTS") {
      setUpfront("0,00");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    const command = {
      leadId: screen.leadId,
      sellerMemberId: form.get("sellerMemberId"),
      productId: form.get("productId"),
      description: form.get("description"),
      paymentPlan,
      paymentMethod: form.get("paymentMethod"),
      totalCents: cents(total)?.toString(),
      upfrontCents: cents(upfront)?.toString(),
      installmentCents: cents(installmentValue)?.toString(),
      installmentCount: Number(installments),
    };
    const fingerprint = JSON.stringify(command);
    if (idempotency.current?.fingerprint !== fingerprint) {
      idempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    const payload = prepareLeadSaleSchema.safeParse({ ...command, idempotencyKey: idempotency.current.key });
    if (!payload.success) {
      setError(payload.error.issues[0]?.message ?? "Revise os valores da venda.");
      return;
    }
    setPending(true);
    try {
      const prepared = await result<{ opportunityId: string }>(await fetch("/api/opportunities/prepare-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.data),
      }));
      await onPrepared(prepared.opportunityId, {
        description: payload.data.description,
        totalCents: payload.data.totalCents,
        upfrontCents: payload.data.upfrontCents,
        monthlyCents: payload.data.installmentCents,
        durationMonths: payload.data.installmentCount,
        paymentMethod: payload.data.paymentMethod,
        paymentCondition: condition(payload.data),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao preparar o fechamento.");
    } finally {
      setPending(false);
    }
  }

  const defaultSellerId = screen.suggestedSaleSellerId ?? "";
  const defaultProductId = screen.productOptions.find((product) => product.name === "SISTEMA POLITIZAI")?.id
    ?? screen.productOptions[0]?.id ?? "";

  return <section className="space-y-4 rounded-md border p-4" aria-label="Preparar venda do lead">
    <header><h3 className="font-semibold">Dados da venda</h3><p className="mt-1 text-sm text-muted-foreground">Você define o preço e as condições de pagamento desta venda. Confira a entrada e as parcelas antes da confirmação final.</p></header>
    {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <label className="text-sm">Vendedor<select className={inputClass} defaultValue={defaultSellerId} name="sellerMemberId" required><option value="">Selecione</option>{screen.saleSellerOptions.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
      <label className="text-sm">Produto<select className={inputClass} defaultValue={defaultProductId} name="productId" required><option value="">Selecione</option>{screen.productOptions.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Descrição da venda<textarea className={inputClass} minLength={3} maxLength={2_000} name="description" required placeholder="Descreva o que foi vendido e os detalhes combinados." /></label>
      <label className="text-sm">Condição de pagamento<select className={inputClass} onChange={(event) => changePlan(event.target.value as PrepareLeadSaleInput["paymentPlan"])} value={paymentPlan}><option value="UPFRONT_INSTALLMENTS">Entrada + parcelas</option><option value="INSTALLMENTS">Somente parcelas</option><option value="CASH">À vista</option></select></label>
      <label className="text-sm">Forma de pagamento<select className={inputClass} defaultValue="PIX" name="paymentMethod" required><option value="PIX">PIX</option><option value="BANK_TRANSFER">Transferência bancária</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="OTHER">Outro</option></select></label>
      <label className="text-sm">Valor total (R$)<input className={inputClass} inputMode="decimal" onChange={(event) => { setTotal(event.target.value); if (paymentPlan === "CASH") setUpfront(event.target.value); }} required value={total} placeholder="18.000,00" /></label>
      <label className="text-sm">Entrada (R$)<input className={inputClass} disabled={paymentPlan === "INSTALLMENTS"} inputMode="decimal" onChange={(event) => setUpfront(event.target.value)} required value={upfront} /></label>
      <label className="text-sm">Número de parcelas<input className={inputClass} disabled={paymentPlan === "CASH"} max="60" min="1" onChange={(event) => setInstallments(event.target.value)} required type="number" value={installments} /></label>
      <label className="text-sm">Valor de cada parcela (R$)<input className={inputClass} disabled={paymentPlan === "CASH"} inputMode="decimal" onChange={(event) => setInstallmentValue(event.target.value)} required value={installmentValue} /></label>
      {reconciliation ? <p className={`rounded-md border p-3 text-sm sm:col-span-2 ${reconciliation.difference === 0n ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`} role="status">Conferência: entrada + parcelas = <strong>{money(reconciliation.composed)}</strong> de <strong>{money(reconciliation.totalCents)}</strong>{reconciliation.difference === 0n ? " — valores conferem." : ` — diferença de ${money(reconciliation.difference < 0n ? -reconciliation.difference : reconciliation.difference)}.`}</p> : null}
      <Button className="sm:col-span-2" disabled={pending || !reconciliation || reconciliation.difference !== 0n} type="submit">{pending ? "Preparando…" : "Continuar fechamento"}</Button>
    </form>
  </section>;
}
