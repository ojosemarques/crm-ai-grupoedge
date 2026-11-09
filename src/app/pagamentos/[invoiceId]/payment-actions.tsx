"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const scenarios = ["SUCCESS", "DECLINED", "TIMEOUT", "PERMANENT_FAILURE", "CHARGEBACK", "UNMATCHED"] as const;

export function PaymentActions({
  sandboxEnabled, invoiceId, status, revision, canManage, canReprocess, canMarkNotReceived, canReschedule, deadLetterAttempts,
}: {
  sandboxEnabled: boolean;
  invoiceId: string;
  status: string;
  revision: number;
  canManage: boolean;
  canReprocess: boolean;
  canMarkNotReceived: boolean;
  canReschedule: boolean;
  deadLetterAttempts: readonly { id: string }[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [scenario, setScenario] = useState<(typeof scenarios)[number]>("SUCCESS");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function send(payload: unknown) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/payments/${invoiceId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error?.message ?? "A ação falhou de forma controlada.");
        return;
      }
      setMessage("Ação registrada.");
      router.refresh();
    } catch {
      setMessage("Não foi possível verificar a ação. Recarregue a cobrança antes de tentar novamente.");
    } finally {
      setPending(false);
    }
  }

  return <section className="surface-panel">
    <div className="section-heading"><div><p className="eyebrow">Cobrança</p><h2>Ações</h2></div></div>
    <label><span className="field-label">Motivo da ação</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Evidência operacional" /></label>
    <div className="button-row">
      {canManage && status === "DRAFT" && <Button disabled={pending || reason.trim().length < 3} onClick={() => send({ action: "ISSUE", expectedRevision: revision, reason })}>Emitir cobrança</Button>}
      {sandboxEnabled && canManage && ["OPEN", "PARTIALLY_PAID"].includes(status) && <>
        <select aria-label="Cenário do sandbox" value={scenario} onChange={(event) => setScenario(event.target.value as typeof scenario)}>{scenarios.map((item) => <option key={item}>{item}</option>)}</select>
        <Button disabled={pending} onClick={() => send({ action: "CHARGE", expectedRevision: revision, scenario, idempotencyKey: `charge-ui:${crypto.randomUUID()}` })}>Simular pagamento</Button>
      </>}
      {canManage && ["DRAFT", "OPEN"].includes(status) && <Button variant="secondary" disabled={pending || reason.trim().length < 8} onClick={() => send({ action: "VOID", expectedRevision: revision, reason })}>Anular</Button>}
      {sandboxEnabled && canReprocess && deadLetterAttempts.map((attempt) => <Button variant="secondary" key={attempt.id} disabled={pending || reason.trim().length < 8} onClick={() => send({ action: "REPLAY", attemptId: attempt.id, reason })}>Reprocessar falha</Button>)}
      {canMarkNotReceived && <Button variant="secondary" disabled={pending} onClick={() => send({ action: "NOT_RECEIVED", expectedRevision: revision, reason })}>Registrar não recebido</Button>}
    </div>
    {canReschedule && <div className="button-row">
      <label><span className="field-label">Novo vencimento</span><input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
      <Button variant="secondary" disabled={pending || !dueOn || reason.trim().length < 8} onClick={() => send({ action: "RESCHEDULE", expectedRevision: revision, dueOn, reason })}>Reagendar cobrança</Button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
