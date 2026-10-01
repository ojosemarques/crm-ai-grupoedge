"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type ActivityOrigin = "LEAD" | "CADENCE" | "MEETING" | "OPPORTUNITY" | "OPPORTUNITY_STAGE" | "POST_SALE";
type ActivityItem = Readonly<{ id: string; recordType: "TASK" | "MEETING"; leadId: string; leadName: string; opportunityId: string | null; opportunityName: string | null; meetingId: string | null; stageName: string | null; title: string; description: string | null; kind: string; status: string; priority: string; dueAt: string; ownerMemberId: string | null; ownerName: string; origin: ActivityOrigin; href: string; stageActivityInstanceId: string | null; activityType: string | null; script: string | null; reentryPolicy: "RECREATE_ON_REENTRY" | "ONCE_PER_OPPORTUNITY" | null }>;
type ReviewItem = Readonly<{ id: string; opportunityId: string; opportunityName: string; ownerMemberId: string; stageName: string; type: string; severity: string; status: string; title: string; evidenceSummary: string; detectedAt: string; lastDetectedAt: string }>;
type ActivityFilters = Readonly<{ kind: string; status: string; origin: string; owner: string; timeframe: "ALL" | "OVERDUE" | "TODAY" | "FUTURE"; grouping: "NONE" | "OWNER" | "TYPE"; calendar: boolean }>;
type ActivityScreen = Readonly<{ generatedAt: string; counts: Readonly<{ total: number; overdue: number; leads: number; cadence: number; meetings: number; opportunities: number; postSale: number }>; items: readonly ActivityItem[]; canWrite: boolean; canAssign: boolean; assignmentTargets: readonly Readonly<{ id: string; name: string }>[]; savedViews: readonly Readonly<{ id: string; name: string; filters: ActivityFilters }>[] }>;
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
function dayBucket(value: string, now: number): "Atrasadas" | "Hoje" | "Futuras" {
  const due = new Date(value);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return due < start ? "Atrasadas" : due < end ? "Hoje" : "Futuras";
}
function localInputTomorrow() { const value = new Date(Date.now() + 86_400_000); value.setSeconds(0, 0); return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
const originLabels: Readonly<Record<ActivityOrigin, string>> = Object.freeze({ LEAD: "Tarefa do lead", CADENCE: "Cadência", MEETING: "Reunião", OPPORTUNITY: "Oportunidade", OPPORTUNITY_STAGE: "Etapa da oportunidade", POST_SALE: "Pós-venda" });
const kindLabels: Readonly<Record<string, string>> = Object.freeze({ GENERAL: "Tarefa", IMMEDIATE_CALL: "Ligação imediata", CALL: "Ligação", MESSAGE: "Mensagem", EMAIL: "E-mail", MEETING: "Reunião", FOLLOW_UP: "Acompanhamento" });
const statusLabels: Readonly<Record<string, string>> = Object.freeze({ OPEN: "Aberta", IN_PROGRESS: "Em andamento", COMPLETED: "Concluída", CANCELLED: "Cancelada" });

function ActivityCard({ item, now, checked, selectable, onToggle }: Readonly<{ item: ActivityItem; now: number; checked: boolean; selectable: boolean; onToggle: () => void }>) {
  return <article className={`rounded-md border bg-background p-4 ${overdue(item.dueAt, now) ? "border-red-300" : ""}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 gap-3">{selectable ? <input aria-label={`Selecionar ${item.title}`} checked={checked} className="mt-1 h-4 w-4" onChange={onToggle} type="checkbox" /> : null}<div><div className="flex flex-wrap gap-2"><span className="rounded-full border px-2 py-1 text-xs">{originLabels[item.origin]}</span><span className="rounded-full border px-2 py-1 text-xs">{kindLabels[item.kind] ?? item.kind}</span><span className="rounded-full border px-2 py-1 text-xs">{statusLabels[item.status] ?? item.status}</span>{overdue(item.dueAt, now) ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-950">Atrasada</span> : null}</div><h3 className="mt-2 font-semibold">{item.title}</h3><p className="text-sm text-muted-foreground">{item.leadName}{item.opportunityName ? ` · ${item.opportunityName}` : ""}{item.stageName ? ` · ${item.stageName}` : ""} · {item.ownerName}</p></div></div><div className="text-right text-sm"><strong>{date(item.dueAt)}</strong><p className="text-xs text-muted-foreground">Prioridade {item.priority}</p></div></div>
    {item.description ? <p className="mt-3 text-sm">{item.description}</p> : null}{item.script ? <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Abrir roteiro</summary><p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{item.script}</p></details> : null}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><small className="text-muted-foreground">{item.origin === "OPPORTUNITY_STAGE" ? item.reentryPolicy === "RECREATE_ON_REENTRY" ? "Prazo recalculado ao retornar para a etapa" : "Criada uma vez para esta oportunidade" : "Prazo persistido no registro original"}</small><Button asChild size="sm" variant="secondary"><Link href={item.href}>Abrir atividade</Link></Button></div>
  </article>;
}

function ActivityCalendar({ items, month, onMonth }: Readonly<{ items: readonly ActivityItem[]; month: Date; onMonth: (month: Date) => void }>) {
  const startOffset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const slots = Array.from({ length: Math.ceil((startOffset + days) / 7) * 7 }, (_, index) => index - startOffset + 1);
  const byDay = new Map<number, ActivityItem[]>();
  for (const item of items) { const due = new Date(item.dueAt); if (due.getFullYear() === month.getFullYear() && due.getMonth() === month.getMonth()) byDay.set(due.getDate(), [...(byDay.get(due.getDate()) ?? []), item]); }
  return <div className="mt-5 rounded-md border bg-background p-3"><div className="flex items-center justify-between gap-3"><Button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} size="sm" variant="secondary">Anterior</Button><strong className="capitalize">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(month)}</strong><Button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} size="sm" variant="secondary">Próximo</Button></div><div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label) => <div className="bg-muted p-2 text-center text-xs font-medium" key={label}>{label}</div>)}{slots.map((day, index) => <div className="min-h-28 bg-background p-2" key={index}>{day > 0 && day <= days ? <><span className="text-xs font-semibold">{day}</span><ul className="mt-1 grid gap-1">{(byDay.get(day) ?? []).slice(0, 4).map((item) => <li className="truncate rounded bg-muted px-1.5 py-1 text-[10px]" key={item.id} title={`${item.title} · ${item.ownerName}`}>{item.title}</li>)}</ul>{(byDay.get(day)?.length ?? 0) > 4 ? <small className="text-muted-foreground">+{(byDay.get(day)?.length ?? 0) - 4}</small> : null}</> : null}</div>)}</div></div>;
}

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
  const [timeframe, setTimeframe] = useState<ActivityFilters["timeframe"]>("ALL");
  const [grouping, setGrouping] = useState<ActivityFilters["grouping"]>("NONE");
  const [calendar, setCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => { const value = new Date(); return new Date(value.getFullYear(), value.getMonth(), 1); });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [targetMemberId, setTargetMemberId] = useState("");
  const [postponeAt, setPostponeAt] = useState(localInputTomorrow);
  const [savedViewName, setSavedViewName] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(50);
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

  const items = useMemo(() => (activities?.items ?? []).filter((item) => {
    if ((kind && item.kind !== kind) || (status && item.status !== status) || (origin && item.origin !== origin) || (owner && item.ownerName !== owner)) return false;
    const bucket = dayBucket(item.dueAt, now);
    return timeframe === "ALL" || (timeframe === "OVERDUE" && bucket === "Atrasadas") || (timeframe === "TODAY" && bucket === "Hoje") || (timeframe === "FUTURE" && bucket === "Futuras");
  }), [activities, kind, status, origin, owner, timeframe, now]);
  const visibleItems = useMemo(() => items.slice(0, visibleLimit), [items, visibleLimit]);
  const groupedItems = useMemo(() => {
    const groups = new Map<string, ActivityItem[]>();
    for (const item of visibleItems) {
      const key = grouping === "OWNER" ? item.ownerName : grouping === "TYPE" ? (kindLabels[item.kind] ?? item.kind) : dayBucket(item.dueAt, now);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const bucketOrder = ["Atrasadas", "Hoje", "Futuras"];
    return [...groups.entries()].sort(([left], [right]) => grouping === "NONE" ? bucketOrder.indexOf(left) - bucketOrder.indexOf(right) : left.localeCompare(right, "pt-BR"));
  }, [visibleItems, grouping, now]);
  const kinds = [...new Set((activities?.items ?? []).map((item) => item.kind))];
  const statuses = [...new Set((activities?.items ?? []).map((item) => item.status))];
  const origins = [...new Set((activities?.items ?? []).map((item) => item.origin))];
  const owners = [...new Set((activities?.items ?? []).map((item) => item.ownerName))];

  const currentFilters: ActivityFilters = { kind, status, origin, owner, timeframe, grouping, calendar };

  function applyFilters(filters: ActivityFilters) {
    setKind(filters.kind); setStatus(filters.status); setOrigin(filters.origin); setOwner(filters.owner); setTimeframe(filters.timeframe); setGrouping(filters.grouping); setCalendar(filters.calendar);
  }

  function toggleSelection(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkCommand(body: Record<string, unknown>, success: string) {
    setPending(true); setNotice(null);
    try {
      await api("/api/sales-activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, taskIds: [...selected] }) });
      setSelected(new Set()); setNotice(success); setActivities(await api<ActivityScreen>("/api/sales-activities", { cache: "no-store" }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao alterar as tarefas."); }
    finally { setPending(false); }
  }

  async function saveView() {
    if (savedViewName.trim().length < 2) { setNotice("Informe um nome para o filtro salvo."); return; }
    setPending(true); setNotice(null);
    try { await api("/api/sales-activities/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: savedViewName, filters: currentFilters }) }); setSavedViewName(""); setActivities(await api<ActivityScreen>("/api/sales-activities", { cache: "no-store" })); setNotice("Filtro salvo."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar o filtro."); }
    finally { setPending(false); }
  }

  async function reviewCommand(body: Record<string, unknown>, success: string) {
    setPending(true); setNotice(null);
    try { await api("/api/opportunities/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setNotice(success); setReviews(await api<ReviewScreen>("/api/opportunities/reviews", { cache: "no-store" })); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setPending(false); }
  }

  return <div className="grid gap-6">
    {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" role="status">{notice}</p> : null}
    <section className="surface-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Fila única de trabalho</h2><p className="mt-1 text-sm text-muted-foreground">Tudo que precisa ser executado, ordenado pelo prazo: leads, contatos, reuniões, oportunidades, cadências e pós-venda.</p></div><Button disabled={pending} onClick={() => void refresh()} size="sm" variant="secondary">Atualizar</Button></div>
      {activities ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-md border bg-background p-3"><span className="text-xs text-muted-foreground">Pendentes</span><strong className="mt-1 block text-xl">{activities.counts.total}</strong></div><div className="rounded-md border border-red-200 bg-red-50/50 p-3"><span className="text-xs text-muted-foreground">Atrasadas</span><strong className="mt-1 block text-xl text-red-800">{activities.counts.overdue}</strong></div><div className="rounded-md border bg-background p-3"><span className="text-xs text-muted-foreground">Cadências</span><strong className="mt-1 block text-xl">{activities.counts.cadence}</strong></div><div className="rounded-md border bg-background p-3"><span className="text-xs text-muted-foreground">Reuniões</span><strong className="mt-1 block text-xl">{activities.counts.meetings}</strong></div><div className="rounded-md border bg-background p-3"><span className="text-xs text-muted-foreground">Pós-venda</span><strong className="mt-1 block text-xl">{activities.counts.postSale}</strong></div></div> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <label className="text-sm">Tipo<select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Todos</option>{kinds.map((item) => <option key={item} value={item}>{kindLabels[item] ?? item}</option>)}</select></label>
        <label className="text-sm">Status<select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{statuses.map((item) => <option key={item} value={item}>{statusLabels[item] ?? item}</option>)}</select></label>
        <label className="text-sm">Origem<select className={inputClass} value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="">Todas</option>{origins.map((item) => <option key={item} value={item}>{originLabels[item]}</option>)}</select></label>
        <label className="text-sm">Responsável<select className={inputClass} value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Todos</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="text-sm">Prazo<select className={inputClass} value={timeframe} onChange={(event) => setTimeframe(event.target.value as ActivityFilters["timeframe"])}><option value="ALL">Todos</option><option value="OVERDUE">Atrasadas</option><option value="TODAY">Hoje</option><option value="FUTURE">Futuras</option></select></label>
        <label className="text-sm">Agrupar<select className={inputClass} value={grouping} onChange={(event) => setGrouping(event.target.value as ActivityFilters["grouping"])}><option value="NONE">Por prazo</option><option value="OWNER">Por vendedor</option><option value="TYPE">Por tipo</option></select></label>
        <label className="flex items-end"><Button className="w-full" onClick={() => setCalendar((value) => !value)} type="button" variant={calendar ? "default" : "secondary"}>{calendar ? "Ver lista" : "Calendário"}</Button></label>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
        <label className="min-w-52 flex-1 text-sm">Salvar filtros<input className={inputClass} maxLength={80} onChange={(event) => setSavedViewName(event.target.value)} placeholder="Ex.: Ligações atrasadas" value={savedViewName} /></label><Button disabled={pending} onClick={() => void saveView()} size="sm" type="button" variant="secondary">Salvar</Button>
        {activities?.savedViews.map((view) => <div className="inline-flex items-center rounded-md border bg-background" key={view.id}><button className="px-3 py-2 text-sm" onClick={() => applyFilters(view.filters)} type="button">{view.name}</button><button aria-label={`Excluir filtro ${view.name}`} className="border-l px-2 py-2 text-sm text-muted-foreground" onClick={() => void api(`/api/sales-activities/saved-views/${view.id}`, { method: "DELETE" }).then(() => refresh()).catch((error) => setNotice(error instanceof Error ? error.message : "Falha ao excluir filtro."))} type="button">×</button></div>)}
      </div>
      {selected.size && activities?.canWrite ? <div className="sticky top-2 z-20 mt-4 flex flex-wrap items-end gap-2 rounded-md border bg-background p-3 shadow-lg"><strong className="mr-auto text-sm">{selected.size} tarefas selecionadas</strong><Button disabled={pending} onClick={() => { if (window.confirm(`Concluir ${selected.size} tarefas selecionadas?`)) void bulkCommand({ action: "COMPLETE", result: "Concluída em lote pela fila de atividades." }, "Tarefas concluídas."); }} size="sm">Concluir</Button>{activities.canAssign ? <><select aria-label="Novo responsável" className={inputClass} onChange={(event) => setTargetMemberId(event.target.value)} value={targetMemberId}><option value="">Novo responsável</option>{activities.assignmentTargets.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><Button disabled={pending || !targetMemberId} onClick={() => void bulkCommand({ action: "REASSIGN", assigneeMemberId: targetMemberId }, "Tarefas reatribuídas.")} size="sm" variant="secondary">Reatribuir</Button></> : null}<input aria-label="Novo prazo" className={inputClass} onChange={(event) => setPostponeAt(event.target.value)} type="datetime-local" value={postponeAt} /><Button disabled={pending || !postponeAt} onClick={() => void bulkCommand({ action: "POSTPONE", dueAt: new Date(postponeAt).toISOString() }, "Tarefas adiadas.")} size="sm" variant="secondary">Adiar</Button><Button onClick={() => setSelected(new Set())} size="sm" variant="secondary">Limpar</Button></div> : null}
      {!activities ? <p className="mt-5 text-sm text-muted-foreground">Carregando fila…</p> : calendar ? <ActivityCalendar items={items} month={calendarMonth} onMonth={setCalendarMonth} /> : items.length ? <><div className="mt-5 grid gap-6">{groupedItems.map(([label, group]) => <section key={label}><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{label}</h3><span className="text-xs text-muted-foreground">{group.length} exibidas</span></div><div className="grid gap-3">{group.map((item) => <ActivityCard checked={selected.has(item.id)} item={item} key={item.id} now={now} onToggle={() => toggleSelection(item.id)} selectable={activities.canWrite && item.recordType === "TASK"} />)}</div></section>)}</div>{visibleItems.length < items.length ? <Button className="mt-5 w-full" onClick={() => setVisibleLimit((value) => value + 50)} type="button" variant="secondary">Carregar mais ({visibleItems.length} de {items.length})</Button> : null}</> : <EmptyState title="Nenhuma atividade neste recorte" description="Ajuste os filtros ou aguarde a próxima tarefa da sua fila." />}
    </section>

    {!reviewForbidden ? <section className="surface-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Revisão gerencial de risco</h2><p className="mt-1 text-sm text-muted-foreground">Ausência de ação, tempo excessivo, valor ou decisor incerto. Nenhum card avança automaticamente.</p></div>{reviews ? <span className="rounded-full border px-3 py-1 text-xs">{reviews.counts.open} abertas · {reviews.counts.acknowledged} reconhecidas</span> : null}</div>
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-4" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void reviewCommand({ action: "SCAN", staleHours: Number(form.get("staleHours")), maxStageDays: Number(form.get("maxStageDays")) }, "Varredura concluída sem mover cards."); }}><label className="text-sm">Sem ação há (horas)<input className={inputClass} defaultValue="72" min="24" name="staleHours" type="number" /></label><label className="text-sm">Máximo na etapa (dias)<input className={inputClass} defaultValue="30" min="1" name="maxStageDays" type="number" /></label><Button disabled={pending} type="submit" variant="secondary">Executar varredura</Button></form>
      {reviews?.items.length ? <div className="mt-4 grid gap-3">{reviews.items.map((item) => <article className="rounded-md border p-4" key={item.id}><div className="flex flex-wrap justify-between gap-3"><div><span className="rounded-full border px-2 py-1 text-xs">{item.severity}</span><h3 className="mt-2 font-semibold">{item.title}</h3><p className="text-sm text-muted-foreground">{item.opportunityName} · {item.stageName}</p></div><span className="text-xs text-muted-foreground">{item.status} · {date(item.lastDetectedAt)}</span></div><p className="mt-3 text-sm">{item.evidenceSummary}</p><form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; void reviewCommand({ action: submitter?.value, reviewId: item.id, reason: form.get("reason") }, submitter?.value === "RESOLVE_REVIEW" ? "Revisão resolvida por pessoa." : "Revisão reconhecida por pessoa."); }}><label className="min-w-64 flex-1 text-sm">Decisão humana<input className={inputClass} minLength={3} name="reason" required /></label>{item.status === "OPEN" ? <Button disabled={pending} name="action" size="sm" type="submit" value="ACKNOWLEDGE_REVIEW" variant="secondary">Reconhecer</Button> : null}<Button disabled={pending} name="action" size="sm" type="submit" value="RESOLVE_REVIEW">Resolver</Button><Button asChild size="sm" variant="secondary"><Link href={`/oportunidades?opportunityId=${item.opportunityId}`}>Abrir card</Link></Button></form></article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma revisão de risco aberta neste recorte.</p>}
    </section> : null}
  </div>;
}
