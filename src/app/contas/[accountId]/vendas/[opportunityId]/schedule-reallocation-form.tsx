"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type Installment = { id: string; number: string; totalCents: string; dueOn: string; revision: number; priceOnly: boolean };
type Amendment = { revision: number; totalCents: string; upfrontCents: string; paymentTerms: string };

function reais(cents: string) {
  const value = BigInt(cents);
  return `${value / 100n},${String(value % 100n).padStart(2, "0")}`;
}

function cents(input: FormDataEntryValue | null) {
  const value = /^(\d{1,14})(?:[,.](\d{1,2}))?$/.exec(String(input ?? ""));
  return value ? BigInt(value[1]!) * 100n + BigInt((value[2] ?? "").padEnd(2, "0")) : null;
}

export function ScheduleReallocationForm({ action, installments, amendment }: {
  action: string; installments: Installment[]; amendment: Amendment | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const canRedistribute = installments.filter((item) => !item.priceOnly).length >= 2;
  const [amending, setAmending] = useState(!canRedistribute && Boolean(amendment));
  const eligible = installments.filter((item) => amending || !item.priceOnly);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const selected = eligible.filter((item) => data.has(`select:${item.id}`));
    const revisingPrice = amending && amendment;
    if (selected.length < (revisingPrice ? 1 : 2)) { setMessage("Selecione as parcelas futuras que serão revistas."); return; }
    const rows = [];
    for (const item of selected) {
      const amountCents = cents(data.get(`amount:${item.id}`));
      if (amountCents === null || amountCents <= 0n) { setMessage(`Informe um valor positivo para ${item.number}.`); return; }
      const dueOn = data.get(`due:${item.id}`);
      rows.push({
        invoiceId: item.id, expectedRevision: item.revision, amountCents: amountCents.toString(),
        ...(typeof dueOn === "string" && dueOn && dueOn !== item.dueOn ? { dueOn } : {}),
      });
    }
    const previous = selected.reduce((sum, item) => sum + BigInt(item.totalCents), 0n);
    const proposed = rows.reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
    const newTotal = revisingPrice ? cents(data.get("newTotal")) : null;
    const newUpfront = revisingPrice ? cents(data.get("newUpfront")) : null;
    if (revisingPrice && (newTotal === null || newTotal <= 0n || newTotal - BigInt(revisingPrice.totalCents) !== proposed - previous)) {
      setMessage("A diferença nas parcelas selecionadas deve corresponder à mudança do total contratual."); return;
    }
    if (!revisingPrice && previous !== proposed) { setMessage("A soma das parcelas selecionadas deve permanecer igual."); return; }
    if (revisingPrice && (newUpfront === null || newTotal === null || newUpfront > newTotal)) {
      setMessage("Informe uma entrada válida, limitada ao novo total."); return;
    }
    const body = {
      reason: data.get("reason"), installments: rows,
      ...(revisingPrice && newTotal !== null && newUpfront !== null ? { amendment: {
        expectedContractRevision: revisingPrice.revision, totalCents: newTotal.toString(), paymentTerms: data.get("paymentTerms"),
        upfrontCents: newUpfront.toString(),
        acceptedByName: data.get("acceptedByName"), acceptedByRole: data.get("acceptedByRole"), evidenceText: data.get("evidenceText"),
      } } : {}),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(action, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }),
      });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error?.message ?? "Não foi possível revisar as parcelas."); return; }
      setMessage("Parcelas revisadas.");
      router.refresh();
    } catch {
      setMessage("Não foi possível verificar a revisão. Tente novamente para consultar o mesmo envio.");
    } finally {
      setPending(false);
    }
  }

  return <details className="my-4 rounded-md border p-4">
    <summary className="cursor-pointer font-semibold">Redistribuir parcelas futuras</summary>
    <p className="my-2 text-sm">Selecione as cobranças que participarão da revisão.</p>
    <form onSubmit={submit}>
      <fieldset disabled={pending} className="grid gap-3">
        {amendment && <label>
          <input type="checkbox" checked={amending} disabled={!canRedistribute} onChange={(event) => setAmending(event.target.checked)} />
          {" "}Corrigir total contratual antes da confirmação
        </label>}
        {amending && amendment && <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid">Novo total (R$)<input name="newTotal" inputMode="decimal" defaultValue={reais(amendment.totalCents)} required /></label>
          <label className="grid">Entrada revisada (R$)<input name="newUpfront" inputMode="decimal" defaultValue={reais(amendment.upfrontCents)} required /></label>
          <p className="sm:col-span-2 text-sm">Para alterar a entrada, selecione a cobrança que a contém. Quando não há entrada, selecione a primeira cobrança.</p>
          <label className="grid">Quem aceitou a revisão<input name="acceptedByName" minLength={2} maxLength={200} required /></label>
          <label className="grid">Cargo ou papel<input name="acceptedByRole" minLength={2} maxLength={200} required /></label>
          <label className="grid">Evidência do aceite<textarea name="evidenceText" minLength={5} maxLength={2000} required /></label>
          <label className="grid sm:col-span-2">Condição revisada<textarea name="paymentTerms" defaultValue={amendment.paymentTerms} minLength={5} maxLength={2000} required /></label>
        </div>}
        {eligible.map((item) => <div key={item.id} className="grid gap-2 rounded border p-2 sm:grid-cols-3">
          <label><input name={`select:${item.id}`} type="checkbox" /> {item.number}</label>
          <label className="grid">Valor (R$) · {item.number}<input name={`amount:${item.id}`} inputMode="decimal" defaultValue={reais(item.totalCents)} /></label>
          <label className="grid">Vencimento · {item.number}<input name={`due:${item.id}`} type="date" defaultValue={item.dueOn} /></label>
        </div>)}
        <label className="grid">Motivo da revisão<textarea name="reason" required minLength={8} maxLength={500} /></label>
        <div><Button type="submit" disabled={pending}>{pending ? "Salvando…" : amending ? "Salvar revisão contratual" : "Salvar redistribuição"}</Button></div>
      </fieldset>
      {message && <p role="status" className="mt-3">{message}</p>}
    </form>
  </details>;
}
