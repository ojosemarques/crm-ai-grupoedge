"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { LeadPipelineState } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

async function readResult(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string }; result?: unknown };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível alterar a etapa.");
  return body.result;
}

export function LeadStageWorkspace({
  pipeline,
  timeZone,
  onUpdated,
  onCommitted,
}: Readonly<{
  pipeline: LeadPipelineState;
  timeZone: string;
  onUpdated: (pipeline: LeadPipelineState) => void;
  onCommitted: () => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${pipeline.leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStageId: String(form.get("targetStageId") ?? ""),
          expectedUpdatedAt: pipeline.updatedAt,
          reason: String(form.get("reason") ?? ""),
          origin: "LEAD_CARD",
          managerCorrection: form.get("managerCorrection") === "on",
          confirmed: form.get("confirmed") === "on",
          disqualificationReasonId: String(form.get("disqualificationReasonId") ?? "") || null,
        }),
      });
      await readResult(response);
      const currentResponse = await fetch(`/api/leads/${pipeline.leadId}/stage`, { cache: "no-store" });
      const current = (await readResult(currentResponse)) as LeadPipelineState;
      onUpdated(current);
      await onCommitted();
      setNotice({ kind: "success", message: `Etapa atualizada para ${current.currentStageName}.` });
      formElement.reset();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="surface-panel scroll-mt-4 p-5" id="alterar-etapa">
      <h2 className="text-lg font-semibold">Etapa de pré-vendas</h2>
      <p className="mt-2 text-sm">Atual: <strong>{pipeline.currentStageName}</strong></p>
      <p className="mt-1 text-xs text-muted-foreground">
        Entrada nesta etapa: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(pipeline.stageEnteredAt))}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded border px-2 py-1">Próxima ação: {pipeline.hasNextAction ? "presente" : "ausente"}</span>
        <span className="rounded border px-2 py-1">PACTO: {pipeline.pactoReady ? "validado" : "incompleto"}</span>
      </div>
      {pipeline.canWrite ? (
        <form className="mt-4 grid gap-4" onSubmit={submit}>
          {pipeline.canCorrect ? <label className="flex items-center gap-2 text-sm"><input name="managerCorrection" type="checkbox" /> Correção gerencial</label> : null}
          <label className="text-sm">Etapa de destino
            <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="targetStageId" required>
              <option value="">Selecione</option>
              {pipeline.transitions.map((option) => <option key={option.stageId} value={option.stageId}>{option.name}{option.allowed ? "" : ` — ${option.blockReason}`}</option>)}
            </select>
          </label>
          <label className="text-sm">Motivo<textarea className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2" name="reason" required /></label>
          <label className="text-sm">Motivo de desqualificação
            <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" name="disqualificationReasonId"><option value="">Não se aplica</option>{pipeline.disqualificationReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select>
          </label>
          <label className="flex items-start gap-2 text-sm"><input name="confirmed" type="checkbox" /><span>Confirmo quando a etapa for sensível ou a mudança for uma correção gerencial.</span></label>
          <ul className="space-y-1 text-xs text-muted-foreground">{pipeline.transitions.filter((option) => option.blockReason).map((option) => <li key={option.stageId}>{option.name}: {option.blockReason}</li>)}</ul>
          <Button disabled={pending} type="submit">{pending ? "Alterando…" : "Alterar etapa"}</Button>
        </form>
      ) : <p className="mt-4 rounded border border-dashed p-3 text-sm text-muted-foreground">Sem permissão para alterar a etapa deste lead.</p>}
      {notice ? <p className={`mt-4 rounded border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    </article>
  );
}
