"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

export function LeadProposalPanel({ leadId, onCommitted }: Readonly<{
  leadId: string;
  onCommitted: () => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setPending(true);
    setNotice(null);
    try {
      const amount = String(form.get("amount") ?? "").trim();
      const sentAt = String(form.get("sentAt") ?? "").trim();
      const response = await fetch(`/api/leads/${leadId}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECORD_PROPOSAL", data: {
          name: String(form.get("name") ?? ""),
          amountCents: amount ? Math.round(Number(amount) * 100) : null,
          ...(sentAt ? { sentAt: new Date(sentAt).toISOString() } : {}),
          conditions: String(form.get("conditions") ?? ""),
          details: String(form.get("details") ?? ""),
        } }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível registrar a proposta.");
      element.reset();
      setNotice({ kind: "success", message: "Proposta enviada registrada no histórico do lead." });
      await onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível registrar a proposta." });
    } finally {
      setPending(false);
    }
  }

  return <article aria-labelledby="lead-proposal-title" className="surface-panel p-5" id="proposta-enviada">
    <h2 className="text-lg font-semibold" id="lead-proposal-title">Proposta enviada</h2>
    <p className="mt-1 text-sm text-muted-foreground">Registre o que foi enviado ao cliente. As informações ficam salvas na timeline com o responsável pelo registro.</p>
    <form className="mt-4 grid gap-4" onSubmit={submit}>
      <label className="text-sm">Nome da proposta<input className={inputClass} maxLength={180} minLength={2} name="name" required /></label>
      <label className="text-sm">Valor da proposta (R$)<input className={inputClass} min="0" name="amount" step="0.01" type="number" /></label>
      <label className="text-sm">Data e hora do envio<input className={inputClass} name="sentAt" type="datetime-local" /><span className="mt-1 block text-xs text-muted-foreground">Se não informar, será usada a data e hora do registro.</span></label>
      <label className="text-sm">Condições de pagamento<textarea className={inputClass} maxLength={1500} name="conditions" placeholder="Entrada, parcelas, prazos e validade da proposta" /></label>
      <label className="text-sm">Detalhes da proposta<textarea className={`${inputClass} min-h-28`} maxLength={2500} name="details" placeholder="Produto ou serviço, escopo e informações da proposta enviada" /></label>
      <Button disabled={pending} type="submit">{pending ? "Registrando…" : "Registrar proposta enviada"}</Button>
    </form>
    {notice ? <p className={`mt-3 text-sm ${notice.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
  </article>;
}
