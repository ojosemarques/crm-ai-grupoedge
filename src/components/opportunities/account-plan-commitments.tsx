"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type Commitment = Readonly<{ id: string; kind: string; opportunityId: string; opportunityName: string; title: string; ownerMemberId: string | null; ownerName: string | null; dueAt: string; status: string; overdue: boolean; unassigned: boolean; href: string }>;
type Queue = Readonly<{ generatedAt: string; items: readonly Commitment[] }>;

function date(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function kind(value: string) {
  return ({ EPISODE: "Episódio", TRACK: "Trilha", WAIT: "Revisão de espera" } as Record<string, string>)[value] ?? "Compromisso";
}

export function AccountPlanCommitments({ timeZone }: Readonly<{ timeZone: string }>) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [filter, setFilter] = useState<"ALL" | "OVERDUE" | "UNASSIGNED">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/account-plan/commitments", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { result?: Queue; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar os compromissos consultivos.");
      setQueue(body.result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada ao carregar compromissos."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/account-plan/commitments", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { result?: Queue; error?: { message?: string } };
        if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar os compromissos consultivos.");
        return body.result;
      })
      .then((result) => { if (active) setQueue(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Falha inesperada ao carregar compromissos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const overdue = queue?.items.filter((item) => item.overdue) ?? [];
  const unassigned = queue?.items.filter((item) => item.unassigned) ?? [];
  const visible = useMemo(() => queue?.items.filter((item) => filter === "ALL" || (filter === "OVERDUE" ? item.overdue : item.unassigned)) ?? [], [filter, queue]);

  return (
    <section aria-labelledby="consultative-commitments-title" className="surface-panel grid gap-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Venda de longo ciclo</p><h2 className="mt-1 text-lg font-semibold" id="consultative-commitments-title">Compromissos do plano de conta</h2><p className="mt-1 text-sm text-muted-foreground">Retornos pactuados, marcos vencidos e itens que precisam de dono.</p></div><Button disabled={loading} onClick={() => void load()} size="sm" type="button" variant="secondary">Atualizar compromissos</Button></header>
      <nav aria-label="Filtros de compromissos" className="grid gap-2 sm:grid-cols-3"><button aria-pressed={filter === "ALL"} className="rounded-md border p-3 text-left text-sm aria-pressed:border-primary aria-pressed:bg-muted" onClick={() => setFilter("ALL")} type="button"><span className="block text-xs text-muted-foreground">Em aberto</span><strong className="text-xl">{queue?.items.length ?? 0}</strong></button><button aria-pressed={filter === "OVERDUE"} className="rounded-md border p-3 text-left text-sm aria-pressed:border-primary aria-pressed:bg-muted" onClick={() => setFilter("OVERDUE")} type="button"><span className="block text-xs text-muted-foreground">Vencidos</span><strong className="text-xl text-destructive">{overdue.length}</strong></button><button aria-pressed={filter === "UNASSIGNED"} className="rounded-md border p-3 text-left text-sm aria-pressed:border-primary aria-pressed:bg-muted" onClick={() => setFilter("UNASSIGNED")} type="button"><span className="block text-xs text-muted-foreground">Sem dono</span><strong className="text-xl">{unassigned.length}</strong></button></nav>
      {error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p> : loading ? <p className="text-sm text-muted-foreground" role="status">Carregando compromissos…</p> : visible.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum compromisso neste recorte.</p> : <div className="grid gap-2">{visible.map((item) => <article className="grid items-center gap-3 rounded-md border p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto]" key={`${item.kind}:${item.id}`}><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{kind(item.kind)}</span>{item.overdue ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">Vencido</span> : null}{item.unassigned ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Sem dono</span> : null}</div><h3 className="mt-1 font-medium">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{item.opportunityName} · {item.ownerName ?? "dono não definido"}</p></div><p className="text-xs"><span className="block text-muted-foreground">Prazo</span><strong>{date(item.dueAt, timeZone)}</strong></p><Button asChild size="sm" variant="secondary"><Link href={item.href}>Abrir plano</Link></Button></article>)}</div>}
      <p className="text-xs text-muted-foreground">Esta fila organiza trabalho humano. Nenhuma mensagem externa é enviada automaticamente.</p>
    </section>
  );
}
