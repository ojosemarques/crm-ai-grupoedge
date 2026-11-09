"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

const modalities = {
  ANNUAL_PREPAID: "Anual antecipado integral",
  ANNUAL_INSTALLMENTS: "Anual parcelado",
  PROJECT: "Projeto ou campanha",
  EXPANSION: "Expansão",
  NEGOTIATED_RENEWAL: "Renovação negociada",
  AUTOMATIC_RENEWAL: "Renovação automática",
  AUTOMATIC_LOW_TICKET: "Low-ticket automático",
};
const fieldClass = "rounded-md border bg-card px-3 py-2";

function formatUpfront(cents: string) {
  if (!cents) return "";
  const value = BigInt(cents);
  return `${value / 100n},${String(value % 100n).padStart(2, "0")}`;
}

export function CustomerConfirmationForm({ action, expectedRevision, netContractCents, sellerOptions, sellerMemberId, initial, upfrontLocked }: {
  action: string; expectedRevision: number; netContractCents: string; sellerMemberId: string;
  upfrontLocked: boolean;
  sellerOptions: { id: string; name: string }[];
  initial: { modality: string; upfrontCents: string; selfSourced: boolean; sourceEvidence: string; confirmationReason: string; acceptedAtLocal: string; activationAtLocal: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const amount = /^(\d{1,14})(?:[,.](\d{1,2}))?$/.exec(String(form.get("upfront") ?? ""));
    if (!amount) { setFeedback("Informe a entrada em reais, com até duas casas decimais."); return; }
    const upfrontCents = (BigInt(amount[1]!) * 100n + BigInt((amount[2] ?? "").padEnd(2, "0"))).toString();
    const body = {
      expectedRevision, netContractCents, sellerMemberId: form.get("sellerMemberId"), modality: form.get("modality"),
      upfrontCents, selfSourced: form.has("selfSourced"), sourceEvidence: form.get("sourceEvidence"),
      acceptedAtLocal: form.get("acceptedAtLocal"), activationAtLocal: form.get("activationAtLocal") || null,
      confirmationReason: form.get("confirmationReason"),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() };
    setFeedback("");
    setPending(true);
    try {
      const response = await fetch(action, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }),
      });
      const result = await response.json();
      if (!response.ok) { setFeedback(result.error?.message ?? "Não foi possível confirmar a venda."); return; }
      router.refresh();
    } catch {
      setFeedback("A confirmação não pôde ser verificada. Tente novamente para consultar o mesmo envio.");
    } finally {
      setPending(false);
    }
  }

  return <form className="max-w-3xl" onSubmit={submit}>
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 font-semibold">{expectedRevision ? "Revisar confirmação" : "Confirmar venda"}</legend>
      <label className="grid gap-1">Vendedor<select name="sellerMemberId" className={fieldClass} defaultValue={sellerMemberId} required>
        {sellerOptions.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
      </select></label>
      <label className="grid gap-1">Modalidade<select name="modality" className={fieldClass} defaultValue={initial.modality} required>
        <option value="" disabled>Selecione</option>
        {Object.entries(modalities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="grid gap-1">Valor líquido contratual<output className={fieldClass}>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(netContractCents) / 100)}</output></label>
      <label className="grid gap-1">Entrada negociada (R$)<input name="upfront" className={fieldClass} inputMode="decimal" defaultValue={formatUpfront(initial.upfrontCents)} readOnly={upfrontLocked} required /></label>
      <label className="grid gap-1">Aceite efetivo<input name="acceptedAtLocal" className={fieldClass} type="datetime-local" defaultValue={initial.acceptedAtLocal} required /></label>
      <label className="grid gap-1">Ativação efetiva<input name="activationAtLocal" className={fieldClass} type="datetime-local" defaultValue={initial.activationAtLocal} /></label>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="selfSourced" defaultChecked={initial.selfSourced} />Prospecção própria comprovada</label>
      <label className="grid gap-1 sm:col-span-2">Evidência da origem<textarea name="sourceEvidence" className={fieldClass} defaultValue={initial.sourceEvidence} minLength={3} maxLength={1000} required /></label>
      <label className="grid gap-1 sm:col-span-2">Motivo e evidência do aceite<textarea name="confirmationReason" className={fieldClass} defaultValue={initial.confirmationReason} minLength={3} maxLength={1000} required /></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar confirmação"}</Button></div>
    </fieldset>
    {feedback && <p className="mt-3" role="alert">{feedback}</p>}
  </form>;
}
