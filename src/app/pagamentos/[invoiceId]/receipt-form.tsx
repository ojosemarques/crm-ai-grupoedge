"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { getPaymentService } from "@/modules/payments/application/payment-service";

type Preview = Awaited<ReturnType<ReturnType<typeof getPaymentService>["previewReceipt"]>>;
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);

export function ReceiptForm({ invoiceId, revision, outstandingCents, accounts }: {
  invoiceId: string; revision: number; outstandingCents: string; accounts: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(action: "PREVIEW" | "CONFIRM", payload: unknown) {
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/payments/${invoiceId}/receipt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, payload }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível registrar o recebimento.");
      if (action === "PREVIEW") { setPreview(body.result); setIdempotencyKey(crypto.randomUUID()); setAttested(false); }
      else { setPreview(null); setMessage("Recebimento registrado. Cobrança, caixa e indicadores atualizados."); router.refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao comunicar com o servidor."); }
    finally { setPending(false); }
  }

  return <section className="surface-panel">
    <div className="section-heading"><h2>Registrar recebimento</h2></div>
    <p>Informe um pagamento já recebido. A confirmação baixa a cobrança e atualiza a conta financeira.</p>
    {accounts.length === 0 ? <p>Cadastre uma conta ativa em <a href="/financeiro">Financeiro</a> antes de registrar o recebimento.</p> : preview ? <>
      <dl><dt>Cliente / cobrança</dt><dd>{preview.preview.customerName} · {preview.preview.invoiceNumber}</dd><dt>Conta</dt><dd>{preview.preview.financialAccountName}</dd><dt>Valor recebido</dt><dd>{money(preview.preview.amountCents)}</dd><dt>Data</dt><dd>{new Date(preview.preview.receivedAt).toLocaleString("pt-BR")}</dd><dt>Forma e referência</dt><dd>{preview.preview.method} · {preview.preview.reference}</dd><dt>Saldo restante</dt><dd>{money(preview.preview.outstandingAfterCents)}</dd></dl>
      <p>{preview.preview.effect}</p>
      <label><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /> Confirmo que este dinheiro foi recebido na conta informada.</label>
      <div className="button-row"><Button disabled={pending || !attested} onClick={() => submit("CONFIRM", { ...preview.input, confirmed: true, idempotencyKey })}>Confirmar recebimento</Button><Button variant="secondary" disabled={pending} onClick={() => setPreview(null)}>Editar</Button></div>
    </> : <form onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const amount = String(values.get("amount"));
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount)) { setMessage("Informe um valor positivo com até duas casas decimais."); return; }
      const [units, cents = ""] = amount.replace(",", ".").split(".");
      const amountCents = (BigInt(units!) * 100n + BigInt(cents.padEnd(2, "0"))).toString();
      void submit("PREVIEW", { expectedRevision: revision, financialAccountId: values.get("financialAccountId"), amountCents, receivedAt: new Date(String(values.get("receivedAt"))).toISOString(), method: values.get("method"), reference: values.get("reference") });
    }}>
      <label><span className="field-label">Conta financeira</span><select name="financialAccountId" required>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span className="field-label">Valor recebido (R$)</span><input name="amount" inputMode="decimal" defaultValue={(Number(outstandingCents) / 100).toFixed(2)} required /></label>
      <label><span className="field-label">Data e hora do recebimento</span><input name="receivedAt" type="datetime-local" required /></label>
      <label><span className="field-label">Forma</span><select name="method"><option value="PIX">Pix</option><option value="BANK_TRANSFER">Transferência bancária</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="OTHER">Outra</option></select></label>
      <label><span className="field-label">Referência única do comprovante</span><input name="reference" minLength={3} maxLength={180} required placeholder="Identificador da transação ou recibo" /></label>
      <Button type="submit" disabled={pending}>Revisar recebimento</Button>
    </form>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
