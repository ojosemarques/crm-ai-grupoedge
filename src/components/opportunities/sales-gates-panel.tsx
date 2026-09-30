"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type GateEvidenceType = "DIAGNOSIS" | "ECONOMIC_BUYER" | "SPONSOR" | "USE_CASE" | "PILOT_CRITERIA" | "PROPOSAL_SCOPE" | "DECISION";
type GateScreen = Readonly<{
  opportunityId: string;
  revision: number;
  salesGateProfile: string;
  pacto: Readonly<{ validated: boolean; revisionId: string | null }>;
  evidence: readonly Readonly<{ id: string; type: GateEvidenceType; summary: string; stakeholderName: string | null; sourceUrl: string | null; version: number; confirmedAt: string }>[];
  requiredEvidence: readonly Readonly<{ type: GateEvidenceType; label: string; present: boolean }>[];
  stageActivities: readonly Readonly<{ id: string; title: string; script: string | null; activityType: string; dueAt: string; status: string; taskId: string; reentryPolicy: "RECREATE_ON_REENTRY" | "ONCE_PER_OPPORTUNITY" }>[];
  reviews: readonly Readonly<{ id: string; reason?: string; type?: string; status?: string; createdAt?: string }>[];
}>;

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const labels: Record<GateEvidenceType, string> = {
  DIAGNOSIS: "Diagnóstico", ECONOMIC_BUYER: "Comprador econômico", SPONSOR: "Patrocinador", USE_CASE: "Caso de uso",
  PILOT_CRITERIA: "Critério de piloto", PROPOSAL_SCOPE: "Escopo da proposta", DECISION: "Decisão",
};

async function result(response: Response): Promise<GateScreen> {
  const body = await response.json().catch(() => ({})) as { result?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível consultar os gates da venda.");
  return body.result as GateScreen;
}

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function SalesGatesPanel({ opportunityId, onCommitted }: Readonly<{ opportunityId: string; onCommitted?: () => void }>) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<GateScreen | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setPending(true); setNotice(null);
    try { setScreen(await result(await fetch(`/api/opportunities/${opportunityId}/sales-gates`, { cache: "no-store" }))); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setPending(false); }
  }

  async function toggle() {
    const next = !open; setOpen(next);
    if (next && !screen) await load();
  }

  async function command(body: Record<string, unknown>, success: string) {
    setPending(true); setNotice(null);
    try {
      await result(await fetch(`/api/opportunities/${opportunityId}/sales-gates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      await load(); setNotice(success); onCommitted?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); setPending(false); }
  }

  function saveEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!screen) return; const form = new FormData(event.currentTarget);
    void command({ action: "SAVE_EVIDENCE", type: form.get("type"), summary: form.get("summary"), stakeholderName: String(form.get("stakeholderName") ?? "").trim() || undefined, sourceUrl: String(form.get("sourceUrl") ?? "").trim() || undefined, expectedRevision: screen.revision, idempotencyKey: crypto.randomUUID() }, "Evidência confirmada e versionada.");
  }

  return <section className="mt-4 rounded-md border bg-muted/20 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">Evidências e gates de Mandato</h4><p className="text-xs text-muted-foreground">O avanço continua sendo uma decisão humana e será validado novamente no servidor.</p></div><Button disabled={pending} onClick={() => void toggle()} size="sm" type="button" variant="secondary">{open ? "Ocultar" : "Revisar gates"}</Button></div>
    {notice ? <p className="mt-3 rounded-md border p-3 text-sm" role="status">{notice}</p> : null}
    {open && pending && !screen ? <p className="mt-4 text-sm text-muted-foreground">Carregando evidências…</p> : null}
    {open && screen ? <div className="mt-5 grid gap-5">
      <div className="flex flex-wrap gap-2"><span className="rounded-full border px-3 py-1 text-xs">Perfil {screen.salesGateProfile}</span><span className={`rounded-full border px-3 py-1 text-xs ${screen.pacto.validated ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>PACTO {screen.pacto.validated ? "validado por pessoa" : "aguardando validação humana"}</span></div>
      <section><h5 className="text-sm font-semibold">Checklist da etapa</h5><ul className="mt-2 grid gap-2 sm:grid-cols-2">{screen.requiredEvidence.map((item) => <li className="flex items-center gap-2 rounded-md border bg-background p-3 text-sm" key={item.type}><span aria-hidden="true">{item.present ? "✓" : "○"}</span><span>{item.label}</span><small className="ml-auto text-muted-foreground">{item.present ? "presente" : "pendente"}</small></li>)}</ul></section>
      {screen.evidence.length ? <section><h5 className="text-sm font-semibold">Evidências confirmadas</h5><div className="mt-2 grid gap-2">{screen.evidence.map((item) => <article className="rounded-md border bg-background p-3 text-sm" key={item.id}><div className="flex flex-wrap justify-between gap-2"><strong>{labels[item.type]}</strong><small className="text-muted-foreground">v{item.version} · {date(item.confirmedAt)}</small></div><p className="mt-1">{item.summary}</p>{item.stakeholderName ? <p className="mt-1 text-xs text-muted-foreground">Pessoa: {item.stakeholderName}</p> : null}{item.sourceUrl ? <a className="mt-1 block break-all text-xs underline" href={item.sourceUrl} rel="noreferrer" target="_blank">Abrir fonte informada</a> : null}</article>)}</div></section> : null}
      <form className="grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-2" onSubmit={saveEvidence}><h5 className="font-semibold sm:col-span-2">Registrar evidência humana</h5><label className="text-sm">Tipo<select className={inputClass} name="type" required>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Comprador ou patrocinador<input className={inputClass} name="stakeholderName" /></label><label className="text-sm sm:col-span-2">Resumo<textarea className={inputClass} minLength={3} name="summary" required /></label><label className="text-sm sm:col-span-2">Link da fonte<input className={inputClass} name="sourceUrl" type="url" /></label><Button disabled={pending} type="submit">Confirmar evidência</Button></form>
      <section><h5 className="text-sm font-semibold">Atividades da etapa</h5><p className="mt-1 text-xs text-muted-foreground">Tarefas de etapa recalculam o prazo na reentrada quando a política indicar. Tarefas avulsas mantêm a data original.</p>{screen.stageActivities.length ? <div className="mt-2 grid gap-2">{screen.stageActivities.map((item) => <article className="rounded-md border bg-background p-3" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm">{item.title}</strong><p className="text-xs text-muted-foreground">{item.activityType} · vence {date(item.dueAt)} · {item.reentryPolicy === "RECREATE_ON_REENTRY" ? "recria na reentrada" : "uma vez por oportunidade"}</p></div><span className="rounded-full border px-2 py-1 text-xs">{item.status}</span></div>{item.script ? <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Ver script</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.script}</p></details> : null}{item.status !== "COMPLETED" ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "COMPLETE_STAGE_ACTIVITY", instanceId: item.id, result: form.get("result"), expectedRevision: screen.revision }, "Atividade da etapa concluída por ação humana."); }}><label className="min-w-64 flex-1 text-sm">Resultado<input className={inputClass} minLength={2} name="result" required /></label><Button disabled={pending} size="sm" type="submit">Concluir atividade</Button></form> : null}</article>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Nenhuma atividade gerada para a etapa atual.</p>}</section>
      {screen.reviews.length ? <section className="rounded-md border border-amber-300 bg-amber-50 p-4"><h5 className="font-semibold text-amber-950">Revisão humana necessária</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{screen.reviews.map((item) => <li key={item.id}>{item.reason ?? item.type ?? "Revise risco, valor, decisor e próxima ação antes de avançar."}</li>)}</ul><p className="mt-3 text-xs text-amber-900">Nenhuma recomendação move ou encerra o card automaticamente.</p></section> : null}
      <form className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "DEFER", reason: form.get("reason"), reviewAt: new Date(String(form.get("reviewAt") ?? "")).toISOString(), expectedRevision: screen.revision }, "Decisão adiada com revisão agendada."); }}><div className="sm:col-span-2"><h5 className="font-semibold text-amber-950">Adiar decisão</h5><p className="text-xs text-amber-900">O adiamento registra motivo e compromisso de revisão; não avança a etapa.</p></div><label className="text-sm">Revisar em<input className={inputClass} name="reviewAt" required type="datetime-local" /></label><label className="text-sm">Motivo<input className={inputClass} minLength={3} name="reason" required /></label><Button disabled={pending} type="submit" variant="secondary">Registrar adiamento</Button></form>
    </div> : null}
  </section>;
}
