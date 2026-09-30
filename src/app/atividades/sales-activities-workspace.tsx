"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type ActivityItem = Readonly<{ id: string; opportunityId: string; opportunityName: string; stageName: string; title: string; description: string | null; kind: string; status: string; dueAt: string; ownerMemberId: string; ownerName: string; origin: "STAGE" | "STANDALONE"; stageActivityInstanceId: string | null; activityType: string | null; script: string | null; reentryPolicy: "RECREATE_ON_REENTRY" | "ONCE_PER_OPPORTUNITY" | null }>;
type ReviewItem = Readonly<{ id: string; opportunityId: string; opportunityName: string; ownerMemberId: string; stageName: string; type: string; severity: string; status: string; title: string; evidenceSummary: string; detectedAt: string; lastDetectedAt: string }>;
type ActivityScreen = Readonly<{ generatedAt: string; items: readonly ActivityItem[] }>;
type ReviewScreen = Readonly<{ generatedAt: string; counts: Readonly<{ open: number; acknowledged: number }>; items: readonly ReviewItem[] }>;

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { result?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível carregar a fila.");
  return body.result as T;
}
function date(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function overdue(value: string, now: number) { return new Date(value).getTime() < now; }

export function SalesActivitiesWorkspace() {
  const [activities, setActivities] = useState<ActivityScreen | null>(null);
  const [reviews, setReviews] = useState<ReviewScreen | null>(null);
  const [reviewForbidden, setReviewForbidden] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [owner, setOwner] = useState("");
  const [now] = useState(() => Date.now());

  async function refresh() {
    setPending(true); setNotice(null);
    const [activityResult, reviewResult] = await Promise.allSettled([
      api<ActivityScreen>("/api/sales-activities", { cache: "no-store" }),
      api<ReviewScreen>("/api/opportunities/reviews", { cache: "no-store" }),
    ]);
    if (activityResult.status === "fulfilled") setActivities(activityResult.value); else setNotice(activityResult.reason instanceof Error ? activityResult.reason.message : "Falha ao carregar atividades.");
    if (reviewResult.status === "fulfilled") { setReviews(reviewResult.value); setReviewForbidden(false); } else setReviewForbidden(true);
    setPending(false);
  }
  useEffect(() => { let cancelled = false; void Promise.allSettled([api<ActivityScreen>("/api/sales-activities", { cache: "no-store" }), api<ReviewScreen>("/api/opportunities/reviews", { cache: "no-store" })]).then(([activityResult, reviewResult]) => { if (cancelled) return; if (activityResult.status === "fulfilled") setActivities(activityResult.value); else setNotice(activityResult.reason instanceof Error ? activityResult.reason.message : "Falha ao carregar atividades."); if (reviewResult.status === "fulfilled") setReviews(reviewResult.value); else setReviewForbidden(true); }); return () => { cancelled = true; }; }, []);

  const items = useMemo(() => (activities?.items ?? []).filter((item) => (!kind || item.kind === kind) && (!status || item.status === status) && (!origin || item.origin === origin) && (!owner || item.ownerMemberId === owner)), [activities, kind, status, origin, owner]);
  const kinds = [...new Set((activities?.items ?? []).map((item) => item.kind))];
  const statuses = [...new Set((activities?.items ?? []).map((item) => item.status))];
  const owners = [...new Map((activities?.items ?? []).map((item) => [item.ownerMemberId, item.ownerName])).entries()];

  async function reviewCommand(body: Record<string, unknown>, success: string) {
    setPending(true); setNotice(null);
    try { await api("/api/opportunities/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setNotice(success); setReviews(await api<ReviewScreen>("/api/opportunities/reviews", { cache: "no-store" })); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setPending(false); }
  }

  return <div className="grid gap-6">
    {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" role="status">{notice}</p> : null}
    <section className="surface-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Fila diária</h2><p className="mt-1 text-sm text-muted-foreground">Ordenada pelo prazo persistido. Atividades de etapa e tarefas avulsas mantêm regras distintas.</p></div><Button disabled={pending} onClick={() => void refresh()} size="sm" variant="secondary">Atualizar</Button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm">Tipo<select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Todos</option>{kinds.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-sm">Status<select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-sm">Origem<select className={inputClass} value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="">Todas</option><option value="STAGE">Gerada pela etapa</option><option value="STANDALONE">Tarefa avulsa</option></select></label><label className="text-sm">Dono<select className={inputClass} value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Todos</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      {!activities ? <p className="mt-5 text-sm text-muted-foreground">Carregando fila…</p> : items.length ? <div className="mt-5 grid gap-3">{items.map((item) => <article className={`rounded-md border bg-background p-4 ${overdue(item.dueAt, now) && item.status !== "COMPLETED" ? "border-red-300" : ""}`} key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><span className="rounded-full border px-2 py-1 text-xs">{item.origin === "STAGE" ? "Atividade de etapa" : "Tarefa avulsa"}</span><span className="rounded-full border px-2 py-1 text-xs">{item.status}</span>{overdue(item.dueAt, now) && item.status !== "COMPLETED" ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-950">Vencida</span> : null}</div><h3 className="mt-2 font-semibold">{item.title}</h3><p className="text-sm text-muted-foreground">{item.opportunityName} · {item.stageName} · {item.ownerName}</p></div><div className="text-right text-sm"><strong>{date(item.dueAt)}</strong><p className="text-xs text-muted-foreground">{item.kind}</p></div></div>{item.description ? <p className="mt-3 text-sm">{item.description}</p> : null}{item.script ? <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Abrir script</summary><p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{item.script}</p></details> : null}<div className="mt-3 flex flex-wrap items-center justify-between gap-2"><small className="text-muted-foreground">{item.origin === "STAGE" ? item.reentryPolicy === "RECREATE_ON_REENTRY" ? "Prazo recalculado na reentrada" : "Criada uma vez por oportunidade" : "Data da tarefa avulsa preservada"}</small><Button asChild size="sm" variant="secondary"><Link href={`/oportunidades?opportunityId=${item.opportunityId}`}>Abrir oportunidade</Link></Button></div></article>)}</div> : <EmptyState title="Nenhuma atividade neste recorte" description="Ajuste os filtros ou crie uma tarefa vinculada a uma oportunidade." />}
    </section>

    {!reviewForbidden ? <section className="surface-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Revisão gerencial de risco</h2><p className="mt-1 text-sm text-muted-foreground">Ausência de ação, tempo excessivo, valor ou decisor incerto. Nenhum card avança automaticamente.</p></div>{reviews ? <span className="rounded-full border px-3 py-1 text-xs">{reviews.counts.open} abertas · {reviews.counts.acknowledged} reconhecidas</span> : null}</div>
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-4" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void reviewCommand({ action: "SCAN", staleHours: Number(form.get("staleHours")), maxStageDays: Number(form.get("maxStageDays")) }, "Varredura concluída sem mover cards."); }}><label className="text-sm">Sem ação há (horas)<input className={inputClass} defaultValue="72" min="24" name="staleHours" type="number" /></label><label className="text-sm">Máximo na etapa (dias)<input className={inputClass} defaultValue="30" min="1" name="maxStageDays" type="number" /></label><Button disabled={pending} type="submit" variant="secondary">Executar varredura</Button></form>
      {reviews?.items.length ? <div className="mt-4 grid gap-3">{reviews.items.map((item) => <article className="rounded-md border p-4" key={item.id}><div className="flex flex-wrap justify-between gap-3"><div><span className="rounded-full border px-2 py-1 text-xs">{item.severity}</span><h3 className="mt-2 font-semibold">{item.title}</h3><p className="text-sm text-muted-foreground">{item.opportunityName} · {item.stageName}</p></div><span className="text-xs text-muted-foreground">{item.status} · {date(item.lastDetectedAt)}</span></div><p className="mt-3 text-sm">{item.evidenceSummary}</p><form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; void reviewCommand({ action: submitter?.value, reviewId: item.id, reason: form.get("reason") }, submitter?.value === "RESOLVE_REVIEW" ? "Revisão resolvida por pessoa." : "Revisão reconhecida por pessoa."); }}><label className="min-w-64 flex-1 text-sm">Decisão humana<input className={inputClass} minLength={3} name="reason" required /></label>{item.status === "OPEN" ? <Button disabled={pending} name="action" size="sm" type="submit" value="ACKNOWLEDGE_REVIEW" variant="secondary">Reconhecer</Button> : null}<Button disabled={pending} name="action" size="sm" type="submit" value="RESOLVE_REVIEW">Resolver</Button><Button asChild size="sm" variant="secondary"><Link href={`/oportunidades?opportunityId=${item.opportunityId}`}>Abrir card</Link></Button></form></article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma revisão de risco aberta neste recorte.</p>}
    </section> : null}
  </div>;
}
