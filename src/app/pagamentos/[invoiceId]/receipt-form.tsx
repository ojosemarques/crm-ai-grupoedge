"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { getPaymentService } from "@/modules/payments/application/payment-service";
import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";

type Preview = Awaited<ReturnType<ReturnType<typeof getPaymentService>["previewReceipt"]>>;
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);

function parseReais(value: string) {
  const [units, cents = ""] = value.replace(",", ".").split(".");
  return (BigInt(units!) * 100n + BigInt(cents.padEnd(2, "0"))).toString();
}

export function ReceiptForm({ invoiceId, revision, outstandingCents, accounts, timeZone }: {
  invoiceId: string; revision: number; outstandingCents: string; accounts: readonly { id: string; name: string }[]; timeZone: string;
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
      <dl><dt>Cliente / cobrança</dt><dd>{preview.preview.customerName} · {preview.preview.invoiceNumber}</dd><dt>Conta</dt><dd>{preview.preview.financialAccountName}</dd><dt>Valor recebido</dt><dd>{money(preview.preview.amountCents)}</dd><dt>Data</dt><dd>{new Date(preview.preview.receivedAt).toLocaleString("pt-BR", { timeZone })}</dd><dt>Forma e referência</dt><dd>{preview.preview.method} · {preview.preview.reference}</dd><dt>Saldo restante</dt><dd>{money(preview.preview.outstandingAfterCents)}</dd></dl>
      <dl><dt>Líquido comprovado</dt><dd>{preview.input.netSettledCents === undefined ? "Sem evidência" : money(preview.input.netSettledCents)}</dd><dt>Entrada líquida alocada</dt><dd>{preview.input.netUpfrontCents === undefined ? "Sem alocação" : money(preview.input.netUpfrontCents)}</dd></dl>
      <p>{preview.preview.effect}</p>
      <label><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /> Confirmo que este dinheiro foi recebido na conta informada.</label>
      <div className="button-row"><Button disabled={pending || !attested} onClick={() => submit("CONFIRM", { ...preview.input, confirmed: true, idempotencyKey })}>Confirmar recebimento</Button><Button variant="secondary" disabled={pending} onClick={() => setPreview(null)}>Editar</Button></div>
    </> : <form onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const amount = String(values.get("amount"));
      const net = String(values.get("net") ?? "").trim();
      const upfront = String(values.get("netUpfront") ?? "").trim();
      if ([amount, net, upfront].some((value, index) => (index === 0 || value) && !/^\d{1,14}(?:[.,]\d{1,2})?$/.test(value))) {
        setMessage("Informe os valores em reais com até duas casas decimais."); return;
      }
      let receivedAt: Date;
      try { receivedAt = parseWorkspaceLocalDateTime(String(values.get("receivedAt")), timeZone); }
      catch { setMessage("Informe data e hora válidas no fuso da operação."); return; }
      void submit("PREVIEW", {
        expectedRevision: revision, financialAccountId: values.get("financialAccountId"), amountCents: parseReais(amount),
        ...(net ? { netSettledCents: parseReais(net) } : {}),
        ...(upfront ? { netUpfrontCents: parseReais(upfront) } : {}),
        receivedAt: receivedAt.toISOString(), method: values.get("method"), reference: values.get("reference"),
      });
    }}>
      <label><span className="field-label">Conta financeira</span><select name="financialAccountId" required>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span className="field-label">Valor recebido (R$)</span><input name="amount" inputMode="decimal" defaultValue={(Number(outstandingCents) / 100).toFixed(2)} required /></label>
      <label><span className="field-label">Valor líquido creditado (R$)</span><input name="net" inputMode="decimal" placeholder="Conforme comprovante" /></label>
      <label><span className="field-label">Parcela líquida da entrada (R$)</span><input name="netUpfront" inputMode="decimal" placeholder="Somente com alocação comprovada" /></label>
      <label><span className="field-label">Data e hora do recebimento ({timeZone})</span><input name="receivedAt" type="datetime-local" required /></label>
      <label><span className="field-label">Forma</span><select name="method"><option value="PIX">Pix</option><option value="BANK_TRANSFER">Transferência bancária</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="OTHER">Outra</option></select></label>
      <label><span className="field-label">Referência única do comprovante</span><input name="reference" minLength={3} maxLength={180} required placeholder="Identificador da transação ou recibo" /></label>
      <Button type="submit" disabled={pending}>Revisar recebimento</Button>
    </form>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
