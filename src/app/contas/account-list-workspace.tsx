"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell } from "@/components/ui/surface";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Icon } from "@/components/ui/icon";
import styles from "./account-list.module.css";
import type { AccountListItem } from "@/modules/accounts/domain/account-contracts";

const inputClass = "h-10 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels: Record<string, string> = { ACTIVE: "Ativa", INACTIVE: "Inativa", MERGED: "Mesclada", UNKNOWN: "Não informado", CONFIRMED: "Confirmada", NEEDS_REVIEW: "Revisão", PUBLIC_SECTOR: "Setor público", POLITICAL: "Político", PRIVATE_SECTOR: "Setor privado", NONPROFIT: "Terceiro setor", OTHER: "Outro", SOLO: "Individual", SMALL: "Pequena", MEDIUM: "Média", LARGE: "Grande", ENTERPRISE: "Enterprise" };

export function AccountListWorkspace({ initial }: Readonly<{ initial: { items: AccountListItem[]; total: number; canWrite: boolean; canReview: boolean } }>) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), domain: form.get("domain") || null, segment: form.get("segment"), size: form.get("size") }) });
      const body = await response.json();
      if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível criar a conta."); return; }
      setFeedback("Conta criada.");
      setCreating(false);
      router.refresh();
    } catch {
      setFeedback("Não foi possível concluir a solicitação. Verifique sua conexão e tente novamente.");
    } finally {
      setPending(false);
    }

  }
  return <div className={styles.workspace}>
    <div className={styles.summary}>
      <div><span className={styles.metricIcon}><Icon name="vendas" size={18} /></span><span><small>Contas encontradas</small><strong>{initial.total}</strong></span></div>
      <div><span className={styles.metricIcon} data-tone="blue"><Icon name="leads" size={18} /></span><span><small>Pessoas vinculadas nesta página</small><strong>{initial.items.reduce((sum, item) => sum + item.peopleCount, 0)}</strong></span></div>
      <div><span className={styles.metricIcon} data-tone="green"><Icon name="tendencia" size={18} /></span><span><small>Oportunidades abertas nesta página</small><strong>{initial.items.reduce((sum, item) => sum + item.openOpportunities, 0)}</strong></span></div>
    </div>
    <section className={styles.directory}>
      <header className={styles.header}><h2>Todas as empresas <span>{initial.total}</span></h2><div>{initial.canReview ? <Button asChild size="sm" type="button" variant="secondary"><Link href="/contas/revisoes">Revisões</Link></Button> : null}{initial.canWrite ? <Button onClick={() => { setFeedback(null); setCreating(true); }} size="sm" type="button"><Icon name="mais" size={14} />Nova conta</Button> : null}</div></header>
      <form action="/contas" className={styles.filters}><input aria-label="Buscar contas" className={inputClass} name="search" placeholder="Nome, razão social ou domínio" /><select aria-label="Status" className={inputClass} name="status" defaultValue="ALL"><option value="ALL">Todos os status</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="MERGED">Mescladas</option></select><select aria-label="Segmento" className={inputClass} name="segment" defaultValue="ALL"><option value="ALL">Todos os segmentos</option><option value="PUBLIC_SECTOR">Setor público</option><option value="POLITICAL">Político</option><option value="PRIVATE_SECTOR">Setor privado</option><option value="NONPROFIT">Terceiro setor</option></select><select aria-label="Porte" className={inputClass} name="size" defaultValue="ALL"><option value="ALL">Todos os portes</option><option value="SMALL">Pequena</option><option value="MEDIUM">Média</option><option value="LARGE">Grande</option><option value="ENTERPRISE">Enterprise</option></select><Button variant="secondary" type="submit">Filtrar</Button></form>
      {creating ? <AccessibleDialog busy={pending} className="max-w-xl" labelledBy="new-account-title" onDismiss={() => setCreating(false)}><div className={styles.dialogHeader}><div><span>EMPRESAS</span><h2 id="new-account-title">Nova conta</h2><p>Organize os contatos e negócios da empresa em um só lugar.</p></div><button disabled={pending} aria-label="Fechar nova conta" onClick={() => setCreating(false)} type="button">×</button></div><form className={styles.createForm} onSubmit={createAccount}><label className="text-sm">Nome<input className={`${inputClass} mt-1 w-full`} name="name" required /></label><label className="text-sm">Domínio<input className={`${inputClass} mt-1 w-full`} name="domain" placeholder="exemplo.com.br" /></label><label className="text-sm">Segmento<select className={`${inputClass} mt-1 w-full`} name="segment" defaultValue="UNKNOWN"><option value="UNKNOWN">Não informado</option><option value="PUBLIC_SECTOR">Setor público</option><option value="POLITICAL">Político</option><option value="PRIVATE_SECTOR">Setor privado</option><option value="NONPROFIT">Terceiro setor</option><option value="OTHER">Outro</option></select></label><label className="text-sm">Porte<select className={`${inputClass} mt-1 w-full`} name="size" defaultValue="UNKNOWN"><option value="UNKNOWN">Não informado</option><option value="SOLO">Individual</option><option value="SMALL">Pequena</option><option value="MEDIUM">Média</option><option value="LARGE">Grande</option><option value="ENTERPRISE">Enterprise</option></select></label>{feedback ? <p className={styles.formError} role="alert">{feedback}</p> : null}<div className={styles.dialogActions}><Button disabled={pending} onClick={() => setCreating(false)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} type="submit">{pending ? "Criando..." : "Criar conta"}</Button></div></form></AccessibleDialog> : null}
      {feedback && !creating ? <p className="mt-3 text-sm" role="status">{feedback}</p> : null}
    </section>
    {initial.items.length === 0 ? <EmptyState title="Nenhuma conta encontrada" description="Ajuste os filtros ou cadastre uma empresa para reunir seus contatos e negócios." /> : <DataTableShell><table className={styles.table}><thead><tr><th>Conta</th><th>Segmento</th><th>Porte</th><th>Qualidade</th><th>Pessoas</th><th>Oportunidades</th><th></th></tr></thead><tbody>{initial.items.map((item) => <tr key={item.id}><td><div className={styles.company}><span aria-hidden="true" className={styles.companyAvatar}>{item.name.slice(0, 2).toUpperCase()}</span><div><Link href={`/contas/${item.id}`}>{item.name}</Link><small>{item.legalName ?? "Razão social não informada"}</small></div></div></td><td><span className={styles.segment}>{labels[item.segment] ?? item.segment}</span></td><td>{labels[item.size] ?? item.size}</td><td><span className="status-badge" data-tone={item.quality === "NEEDS_REVIEW" ? "warning" : item.quality === "CONFIRMED" ? "success" : "default"}>{labels[item.quality] ?? item.quality}</span></td><td>{item.peopleCount}</td><td>{item.openOpportunities}</td><td><Link className="text-sm font-semibold text-primary" href={`/contas/${item.id}`}>Ver conta →</Link></td></tr>)}</tbody></table></DataTableShell>}
  </div>;
}
