"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Issue = Readonly<{ id: string; reason: string; receiptId: string | null; invoiceId: string | null; createdAt: string }>;
type InvoiceOption = Readonly<{ id: string; invoiceNumber: string; accountName: string }>;

function ReconciliationItem({ issue, invoices }: { issue: Issue; invoices: readonly InvoiceOption[] }) {
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState(issue.invoiceId ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function resolve(action: "LINK_AND_REPROCESS" | "DISMISS") {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/payments/reconciliation/${issue.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, invoiceId: action === "LINK_AND_REPROCESS" ? invoiceId : undefined, reason }),
    });
    const body = await response.json().catch(() => null);
    setPending(false);
    setMessage(response.ok ? "Divergência encerrada com trilha de auditoria." : body?.error?.message ?? "Não foi possível concluir a revisão.");
    if (response.ok) router.refresh();
  }

  return <article className="surface-panel surface-panel-subtle">
    <div className="section-heading">
      <div><strong>{issue.reason}</strong><p className="helper-text">Recebida em {new Date(issue.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>
      {issue.invoiceId ? <Link href={`/pagamentos/${issue.invoiceId}`}>Abrir cobrança</Link> : <span className="status-badge">Sem correspondência</span>}
    </div>
    <label><span className="field-label">Cobrança correta</span><select value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}><option value="">Selecione</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.accountName}</option>)}</select></label>
    <label><span className="field-label">Motivo e evidência da decisão</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva a validação humana" /></label>
    <div className="button-row">
      {issue.receiptId ? <Button disabled={pending || !invoiceId || reason.trim().length < 8} onClick={() => resolve("LINK_AND_REPROCESS")}>Vincular e reprocessar</Button> : null}
      <Button variant="secondary" disabled={pending || reason.trim().length < 8} onClick={() => resolve("DISMISS")}>Descartar com motivo</Button>
    </div>
    {message ? <p role="status">{message}</p> : null}
  </article>;
}

export function PaymentReconciliationPanel({ issues, invoices }: { issues: readonly Issue[]; invoices: readonly InvoiceOption[] }) {
  if (issues.length === 0) return null;
  return <section className="surface-panel">
    <div className="section-heading"><div><p className="eyebrow">Revisão humana</p><h2>Divergências abertas</h2></div><span className="status-badge">{issues.length} pendente(s)</span></div>
    <p className="helper-text">Nenhuma divergência altera cobrança ou receita silenciosamente. Vincule somente quando houver evidência.</p>
    <div className="stack-list">{issues.map((issue) => <ReconciliationItem key={issue.id} issue={issue} invoices={invoices} />)}</div>
  </section>;
}
