"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type MemberOption = Readonly<{ id: string; name: string }>;
type Episode = Readonly<{ id: string; type: "DISCOVERY" | "SOLUTION" | "PILOT" | "CUSTOMER_WAIT" | "CONTRACTING" | "INSTITUTIONAL_NURTURE"; title: string; objective: string; status: string; ownerMemberId: string; ownerName: string; dueAt: string | null; artifactUrl: string | null; taskId: string | null; startedAt: string; completedAt: string | null }>;
type Track = Readonly<{ id: string; type: "STAKEHOLDER" | "POLITIZAI_DELIVERY" | "IMPEDIMENT" | "DECISION"; milestone: string; artifactTitle: string | null; artifactUrl: string | null; status: string; ownerMemberId: string; ownerName: string; dueAt: string; taskId: string | null; revision: number }>;
type PlannedWait = Readonly<{ id: string; reason: string; reviewAt: string; ownerMemberId: string; ownerName: string; taskId: string | null; status: string }>;
type Stakeholder = Readonly<{ id: string; name: string; role: string; isDecisionMaker: boolean; status: string; startedAt: string; endedAt: string | null }>;
type AccountPlan = Readonly<{ opportunityId: string; revision: number; episodes: readonly Episode[]; tracks: readonly Track[]; plannedWait: PlannedWait | null; stakeholders: readonly Stakeholder[] }>;

const fieldClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const episodeLabels: Record<Episode["type"], string> = { DISCOVERY: "Descoberta", SOLUTION: "Solução", PILOT: "Piloto", CUSTOMER_WAIT: "Espera do cliente", CONTRACTING: "Contratação", INSTITUTIONAL_NURTURE: "Nutrição institucional" };
const trackLabels: Record<Track["type"], string> = { STAKEHOLDER: "Stakeholder", POLITIZAI_DELIVERY: "Entrega Politizai", IMPEDIMENT: "Impedimento", DECISION: "Decisão" };

function localToIso(value: FormDataEntryValue | null): string | undefined {
  const source = String(value ?? "").trim();
  if (!source) return undefined;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error("Informe uma data e hora válidas.");
  return date.toISOString();
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function statusLabel(value: string) {
  return ({ ACTIVE: "Em andamento", PLANNED: "Planejado", COMPLETED: "Concluído", CANCELLED: "Cancelado", SUPERSEDED: "Substituído" } as Record<string, string>)[value] ?? value;
}

async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as { result?: AccountPlan; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível atualizar o plano de conta.");
  if (!body.result) throw new Error("O plano de conta retornou uma resposta inválida.");
  return body.result;
}

export function AccountPlanPanel({ opportunityId, memberOptions, timeZone, canWrite }: Readonly<{ opportunityId: string; memberOptions: readonly MemberOption[]; timeZone: string; canWrite: boolean }>) {
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<"EPISODE" | "TRACK" | "WAIT" | "STAKEHOLDER" | null>(null);
  const [completion, setCompletion] = useState<Readonly<{ type: "EPISODE" | "TRACK" | "WAIT"; id: string; title: string }> | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPlan(await readResponse(await fetch(`/api/opportunities/${opportunityId}/account-plan`, { cache: "no-store" }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada ao carregar o plano de conta."); }
    finally { setLoading(false); }
  }, [opportunityId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/opportunities/${opportunityId}/account-plan`, { cache: "no-store" })
      .then(readResponse)
      .then((result) => { if (active) setPlan(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Falha inesperada ao carregar o plano de conta."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opportunityId]);

  async function command(payload: Record<string, unknown>, success: string) {
    if (!plan) return;
    setPending(true); setError(null); setNotice(null);
    try {
      const next = await readResponse(await fetch(`/api/opportunities/${opportunityId}/account-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, expectedRevision: plan.revision, idempotencyKey: crypto.randomUUID() }) }));
      setPlan(next); setNotice(success); setForm(null); setCompletion(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada ao atualizar o plano de conta."); }
    finally { setPending(false); }
  }

  function submitEpisode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void command({ action: "START_EPISODE", type: data.get("type"), title: data.get("title"), objective: data.get("objective"), ownerMemberId: data.get("ownerMemberId"), dueAt: localToIso(data.get("dueAt")), artifactUrl: String(data.get("artifactUrl") ?? "").trim() || undefined }, "Episódio consultivo iniciado.");
  }
  function submitTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void command({ action: "UPSERT_TRACK", type: data.get("type"), milestone: data.get("milestone"), artifactTitle: String(data.get("artifactTitle") ?? "").trim() || undefined, artifactUrl: String(data.get("artifactUrl") ?? "").trim() || undefined, ownerMemberId: data.get("ownerMemberId"), dueAt: localToIso(data.get("dueAt")) }, "Trilha paralela atualizada.");
  }
  function submitWait(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void command({ action: "PLAN_WAIT", reason: data.get("reason"), reviewAt: localToIso(data.get("reviewAt")), ownerMemberId: data.get("ownerMemberId") }, "Espera planejada registrada sem alterar a etapa do pipeline.");
  }
  function submitStakeholder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void command({ action: "CHANGE_STAKEHOLDER", name: data.get("name"), role: data.get("role"), isDecisionMaker: data.get("isDecisionMaker") === "on", replacesStakeholderId: String(data.get("replacesStakeholderId") ?? "") || undefined }, "Troca de stakeholder registrada com histórico preservado.");
  }
  function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!completion) return; const data = new FormData(event.currentTarget);
    void command({ action: "COMPLETE_COMMITMENT", commitmentType: completion.type, commitmentId: completion.id, result: data.get("result") }, "Compromisso concluído e ações incompatíveis canceladas.");
  }

  if (loading) return <section aria-busy="true" className="rounded-lg border p-4 text-sm text-muted-foreground">Carregando plano de conta…</section>;
  if (!plan) return <section className="rounded-lg border p-4"><p className="text-sm text-destructive" role="alert">{error ?? "Plano de conta indisponível."}</p><Button className="mt-3" onClick={() => void load()} size="sm" type="button" variant="secondary">Tentar novamente</Button></section>;

  const activeStakeholders = plan.stakeholders.filter((item) => item.status === "ACTIVE");
  return (
    <section aria-labelledby="account-plan-title" className="grid gap-4 rounded-lg border bg-muted/10 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold" id="account-plan-title">Plano de conta</h3><p className="mt-1 text-sm text-muted-foreground">Episódios consultivos e trilhas paralelas, sem criar etapas artificiais no pipeline.</p></div>{canWrite ? <div className="flex flex-wrap gap-2"><Button onClick={() => setForm("EPISODE")} size="sm" type="button" variant="secondary">Novo episódio</Button><Button onClick={() => setForm("TRACK")} size="sm" type="button" variant="secondary">Nova trilha</Button><Button onClick={() => setForm("WAIT")} size="sm" type="button" variant="secondary">Planejar espera</Button><Button onClick={() => setForm("STAKEHOLDER")} size="sm" type="button" variant="secondary">Trocar stakeholder</Button></div> : null}</header>
      {notice ? <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p> : null}
      {error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p> : null}

      {plan.plannedWait && plan.plannedWait.status === "PLANNED" ? <article className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong>Espera pactuada</strong><p className="mt-1">{plan.plannedWait.reason}</p><p className="mt-1 text-xs">Revisão: {formatDate(plan.plannedWait.reviewAt, timeZone)} · dono: {plan.plannedWait.ownerName}</p></div>{canWrite ? <Button onClick={() => setCompletion({ type: "WAIT", id: plan.plannedWait!.id, title: "Espera pactuada" })} size="sm" type="button" variant="secondary">Encerrar espera</Button> : null}</div></article> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section><h4 className="text-sm font-semibold">Episódios do programa consultivo</h4>{plan.episodes.length === 0 ? <div className="mt-2"><EmptyState description="Registre descoberta, solução, piloto, contratação ou nutrição." title="Nenhum episódio" /></div> : <div className="mt-2 grid gap-2">{plan.episodes.map((item) => <article className="rounded-md border bg-background p-3 text-sm" key={item.id}><div className="flex justify-between gap-2"><div><span className="text-xs font-semibold uppercase text-muted-foreground">{episodeLabels[item.type]}</span><h5 className="font-medium">{item.title}</h5></div><span className="text-xs">{statusLabel(item.status)}</span></div><p className="mt-2 text-muted-foreground">{item.objective}</p><p className="mt-2 text-xs">Dono: {item.ownerName} · {formatDate(item.dueAt, timeZone)}</p>{item.artifactUrl ? <Link className="mt-2 inline-block text-xs font-medium underline" href={item.artifactUrl} rel="noreferrer" target="_blank">Abrir artefato</Link> : null}{canWrite && item.status === "ACTIVE" ? <Button className="mt-3 w-full" onClick={() => setCompletion({ type: "EPISODE", id: item.id, title: item.title })} size="sm" type="button" variant="secondary">Concluir episódio</Button> : null}</article>)}</div>}</section>
        <section><h4 className="text-sm font-semibold">Trilhas paralelas</h4>{plan.tracks.length === 0 ? <div className="mt-2"><EmptyState description="Cada trilha precisa de marco, dono e prazo." title="Nenhuma trilha" /></div> : <div className="mt-2 grid gap-2">{plan.tracks.map((item) => <article className="rounded-md border bg-background p-3 text-sm" key={item.id}><div className="flex justify-between gap-2"><div><span className="text-xs font-semibold uppercase text-muted-foreground">{trackLabels[item.type]}</span><h5 className="font-medium">{item.milestone}</h5></div><span className="text-xs">{statusLabel(item.status)}</span></div><p className="mt-2 text-xs">Artefato: {item.artifactTitle ?? "não definido"} · dono: {item.ownerName}</p><p className="mt-1 text-xs">Prazo: {formatDate(item.dueAt, timeZone)}</p>{item.artifactUrl ? <Link className="mt-2 inline-block text-xs font-medium underline" href={item.artifactUrl} rel="noreferrer" target="_blank">Abrir artefato</Link> : null}{canWrite && item.status === "ACTIVE" ? <Button className="mt-3 w-full" onClick={() => setCompletion({ type: "TRACK", id: item.id, title: item.milestone })} size="sm" type="button" variant="secondary">Concluir marco</Button> : null}</article>)}</div>}</section>
      </div>

      <section><h4 className="text-sm font-semibold">Stakeholders</h4><div className="mt-2 flex flex-wrap gap-2">{activeStakeholders.length ? activeStakeholders.map((item) => <span className="rounded-full border bg-background px-3 py-1 text-xs" key={item.id}>{item.name} · {item.role}{item.isDecisionMaker ? " · decisor" : ""}</span>) : <span className="text-sm text-muted-foreground">Nenhum stakeholder ativo.</span>}</div>{plan.stakeholders.some((item) => item.status !== "ACTIVE") ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Ver histórico de trocas</summary><ul className="mt-2 grid gap-1">{plan.stakeholders.filter((item) => item.status !== "ACTIVE").map((item) => <li key={item.id}>{item.name} · {item.role} · encerrado em {formatDate(item.endedAt, timeZone)}</li>)}</ul></details> : null}</section>

      {form === "EPISODE" ? <form className="grid gap-3 rounded-md border bg-background p-4" onSubmit={submitEpisode}><h4 className="font-semibold">Iniciar episódio</h4><label className="text-sm">Tipo<select className={fieldClass} name="type" required>{Object.entries(episodeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Título<input className={fieldClass} name="title" required /></label><label className="text-sm">Objetivo<textarea className={fieldClass} name="objective" required /></label><label className="text-sm">Dono<select className={fieldClass} name="ownerMemberId" required><option value="">Selecione</option>{memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm">Prazo<input className={fieldClass} name="dueAt" type="datetime-local" /></label><label className="text-sm">URL do artefato<input className={fieldClass} name="artifactUrl" type="url" /></label><div className="flex justify-end gap-2"><Button onClick={() => setForm(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">Iniciar episódio</Button></div></form> : null}
      {form === "TRACK" ? <form className="grid gap-3 rounded-md border bg-background p-4" onSubmit={submitTrack}><h4 className="font-semibold">Criar ou revisar trilha</h4><label className="text-sm">Trilha<select className={fieldClass} name="type" required>{Object.entries(trackLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Marco<input className={fieldClass} name="milestone" required /></label><label className="text-sm">Artefato<input className={fieldClass} name="artifactTitle" /></label><label className="text-sm">URL do artefato<input className={fieldClass} name="artifactUrl" type="url" /></label><label className="text-sm">Dono<select className={fieldClass} name="ownerMemberId" required><option value="">Selecione</option>{memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm">Prazo<input className={fieldClass} name="dueAt" required type="datetime-local" /></label><div className="flex justify-end gap-2"><Button onClick={() => setForm(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">Salvar trilha</Button></div></form> : null}
      {form === "WAIT" ? <form className="grid gap-3 rounded-md border bg-background p-4" onSubmit={submitWait}><h4 className="font-semibold">Planejar espera do cliente</h4><p className="text-sm text-muted-foreground">A espera fica distinta de estagnação e cria um compromisso de revisão.</p><label className="text-sm">Motivo<textarea className={fieldClass} name="reason" required /></label><label className="text-sm">Revisar em<input className={fieldClass} name="reviewAt" required type="datetime-local" /></label><label className="text-sm">Dono<select className={fieldClass} name="ownerMemberId" required><option value="">Selecione</option>{memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex justify-end gap-2"><Button onClick={() => setForm(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">Registrar espera</Button></div></form> : null}
      {form === "STAKEHOLDER" ? <form className="grid gap-3 rounded-md border bg-background p-4" onSubmit={submitStakeholder}><h4 className="font-semibold">Registrar troca de stakeholder</h4><label className="text-sm">Novo stakeholder<input className={fieldClass} name="name" required /></label><label className="text-sm">Papel<input className={fieldClass} name="role" required /></label><label className="text-sm">Substitui<select className={fieldClass} name="replacesStakeholderId"><option value="">Não substitui ninguém</option>{activeStakeholders.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label><label className="flex gap-2 text-sm"><input name="isDecisionMaker" type="checkbox" /> É decisor econômico</label><div className="flex justify-end gap-2"><Button onClick={() => setForm(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">Registrar troca</Button></div></form> : null}
      {completion ? <form className="grid gap-3 rounded-md border bg-background p-4" onSubmit={submitCompletion}><h4 className="font-semibold">Concluir: {completion.title}</h4><label className="text-sm">Resultado<textarea className={fieldClass} name="result" required /></label><div className="flex justify-end gap-2"><Button onClick={() => setCompletion(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">Confirmar conclusão</Button></div></form> : null}
      {canWrite ? <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">Uma resposta encerra esperas incompatíveis. Opt-out cancela compromissos futuros.</p><div className="flex gap-2"><Button disabled={pending} onClick={() => void command({ action: "REGISTER_EVENT", event: "RESPONSE" }, "Resposta registrada; ações incompatíveis foram canceladas.")} size="sm" type="button" variant="secondary">Registrar resposta</Button><Button disabled={pending} onClick={() => void command({ action: "REGISTER_EVENT", event: "OPT_OUT" }, "Opt-out registrado; compromissos futuros foram cancelados.")} size="sm" type="button" variant="secondary">Registrar opt-out</Button></div></div> : null}
    </section>
  );
}
