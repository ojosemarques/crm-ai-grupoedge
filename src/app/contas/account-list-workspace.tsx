"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell, SectionHeader, Surface, StatCard } from "@/components/ui/surface";
import type { AccountListItem } from "@/modules/accounts/domain/account-contracts";

const inputClass = "h-10 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels: Record<string, string> = { ACTIVE: "Ativa", INACTIVE: "Inativa", MERGED: "Mesclada", UNKNOWN: "Não informado", CONFIRMED: "Confirmada", NEEDS_REVIEW: "Revisão", PUBLIC_SECTOR: "Setor público", POLITICAL: "Político", PRIVATE_SECTOR: "Setor privado", NONPROFIT: "Terceiro setor", OTHER: "Outro", SOLO: "Individual", SMALL: "Pequena", MEDIUM: "Média", LARGE: "Grande", ENTERPRISE: "Enterprise" };

export function AccountListWorkspace({ initial }: Readonly<{ initial: { items: AccountListItem[]; total: number; canWrite: boolean; canReview: boolean } }>) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), domain: form.get("domain") || null, segment: form.get("segment"), size: form.get("size") }) });
    const body = await response.json();
    if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível criar a conta."); return; }
    setFeedback("Conta criada com auditoria."); setCreating(false); router.refresh();
  }
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Contas encontradas" value={initial.total} hint="Universo autorizado" /><StatCard label="Pessoas com papel ativo" value={initial.items.reduce((sum, item) => sum + item.peopleCount, 0)} hint="Página atual" /><StatCard label="Oportunidades abertas" value={initial.items.reduce((sum, item) => sum + item.openOpportunities, 0)} hint="Página atual" /></div>
    <Surface tone="subtle"><SectionHeader title="Localizar e criar" description="Documento e domínio são normalizados; texto legado nunca cria vínculo automático." action={<div className="flex gap-2">{initial.canReview ? <Button asChild type="button" variant="secondary"><Link href="/contas/revisoes">Revisões</Link></Button> : null}{initial.canWrite ? <Button onClick={() => setCreating((value) => !value)} type="button">{creating ? "Fechar" : "Nova conta"}</Button> : null}</div>} />
      <form action="/contas" className="mt-4 grid gap-3 md:grid-cols-[1fr_repeat(3,180px)_auto]"><input aria-label="Buscar contas" className={inputClass} name="search" placeholder="Nome, razão social ou domínio" /><select aria-label="Status" className={inputClass} name="status" defaultValue="ALL"><option value="ALL">Todos os status</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="MERGED">Mescladas</option></select><select aria-label="Segmento" className={inputClass} name="segment" defaultValue="ALL"><option value="ALL">Todos os segmentos</option><option value="PUBLIC_SECTOR">Setor público</option><option value="POLITICAL">Político</option><option value="PRIVATE_SECTOR">Setor privado</option><option value="NONPROFIT">Terceiro setor</option></select><select aria-label="Porte" className={inputClass} name="size" defaultValue="ALL"><option value="ALL">Todos os portes</option><option value="SMALL">Pequena</option><option value="MEDIUM">Média</option><option value="LARGE">Grande</option><option value="ENTERPRISE">Enterprise</option></select><Button variant="secondary" type="submit">Filtrar</Button></form>
      {creating ? <form className="mt-4 grid gap-3 rounded-[var(--radius-panel)] border border-border bg-card p-4 md:grid-cols-2" onSubmit={createAccount}><label className="text-sm">Nome<input className={`${inputClass} mt-1 w-full`} name="name" required /></label><label className="text-sm">Domínio<input className={`${inputClass} mt-1 w-full`} name="domain" placeholder="exemplo.com.br" /></label><label className="text-sm">Segmento<select className={`${inputClass} mt-1 w-full`} name="segment" defaultValue="UNKNOWN"><option value="UNKNOWN">Não informado</option><option value="PUBLIC_SECTOR">Setor público</option><option value="POLITICAL">Político</option><option value="PRIVATE_SECTOR">Setor privado</option><option value="NONPROFIT">Terceiro setor</option><option value="OTHER">Outro</option></select></label><label className="text-sm">Porte<select className={`${inputClass} mt-1 w-full`} name="size" defaultValue="UNKNOWN"><option value="UNKNOWN">Não informado</option><option value="SOLO">Individual</option><option value="SMALL">Pequena</option><option value="MEDIUM">Média</option><option value="LARGE">Grande</option><option value="ENTERPRISE">Enterprise</option></select></label><div className="md:col-span-2"><Button type="submit">Criar conta</Button></div></form> : null}
      {feedback ? <p className="mt-3 text-sm" role="status">{feedback}</p> : null}
    </Surface>
    {initial.items.length === 0 ? <EmptyState title="Nenhuma conta encontrada" description="Ajuste os filtros ou crie a primeira conta canônica após confirmar a organização." /> : <DataTableShell><table><thead><tr><th>Conta</th><th>Segmento</th><th>Porte</th><th>Qualidade</th><th>Pessoas</th><th>Oportunidades</th><th></th></tr></thead><tbody>{initial.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="block text-muted-foreground">{item.legalName ?? "Razão social não informada"}</small></td><td>{labels[item.segment] ?? item.segment}</td><td>{labels[item.size] ?? item.size}</td><td><span className="status-badge" data-tone={item.quality === "NEEDS_REVIEW" ? "warning" : item.quality === "CONFIRMED" ? "success" : "default"}>{labels[item.quality] ?? item.quality}</span></td><td>{item.peopleCount}</td><td>{item.openOpportunities}</td><td><Link className="text-sm font-semibold text-primary" href={`/contas/${item.id}`}>Abrir 360</Link></td></tr>)}</tbody></table></DataTableShell>}
  </div>;
}
