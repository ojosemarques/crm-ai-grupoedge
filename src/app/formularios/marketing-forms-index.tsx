"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import styles from "@/app/formularios/marketing-forms.module.css";

type FormListItem = Readonly<{ id: string; name: string; publicSlug: string; status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED"; revision: number; currentVersion: number; publishedAt: string | null; updatedAt: string; responseCount: number; completionRate: number | null }>;
const statusLabel = { DRAFT: "Rascunho", ACTIVE: "Publicado", INACTIVE: "Pausado", ARCHIVED: "Arquivado" } as const;

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

export function MarketingFormsIndex({ initialForms }: Readonly<{ initialForms: readonly FormListItem[] }>) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => initialForms.filter((form) => (!status || form.status === status) && `${form.name} ${form.publicSlug}`.toLowerCase().includes(query.toLowerCase())), [initialForms, query, status]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/marketing/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, publicSlug: slug }) });
      const body = await response.json() as { result?: { id: string }; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível criar o formulário.");
      router.push(`/formularios/${body.result.id}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar o formulário."); setBusy(false); }
  }

  return <section className={styles.index}>
    <div className={styles.indexToolbar}><label className={styles.search}>Buscar formulários<input onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou endereço" type="search" value={query} /></label><label>Status<select onChange={(event) => setStatus(event.target.value)} value={status}><option value="">Todos</option><option value="DRAFT">Rascunho</option><option value="ACTIVE">Publicado</option><option value="INACTIVE">Pausado</option><option value="ARCHIVED">Arquivado</option></select></label><Button onClick={() => { setName(""); setSlug(""); setError(null); setCreating(true); }}>Novo formulário</Button></div>
    {filtered.length ? <div className={styles.formGrid}>{filtered.map((form) => <Link className={styles.formCard} href={`/formularios/${form.id}`} key={form.id}><div><span className={styles.status} data-status={form.status}>{statusLabel[form.status]}</span><span className={styles.version}>v{form.currentVersion}</span></div><h2>{form.name}</h2><p>/f/{form.publicSlug}</p><div className={styles.cardMetrics}><span><b>{form.responseCount}</b> respostas</span><span><b>{form.completionRate === null ? "—" : `${form.completionRate.toLocaleString("pt-BR")}%`}</b> conclusão</span></div><small>Atualizado em {new Date(form.updatedAt).toLocaleString("pt-BR")}</small></Link>)}</div> : <div className={styles.empty}><span aria-hidden="true">◫</span><h2>{query ? "Nenhum resultado" : "Seu primeiro formulário começa aqui"}</h2><p>{query ? "Tente outro nome ou endereço." : "Monte perguntas, conecte ao CRM e publique uma URL pronta para compartilhar."}</p>{!query ? <Button onClick={() => setCreating(true)}>Criar formulário</Button> : null}</div>}
    {creating ? <AccessibleDialog busy={busy} labelledBy="create-form-title" onDismiss={() => setCreating(false)}><form className={styles.createDialog} onSubmit={create}><header><div><span>Novo formulário</span><h2 id="create-form-title">Comece pelo nome e endereço</h2></div><button aria-label="Fechar" disabled={busy} onClick={() => setCreating(false)} type="button">×</button></header><label>Nome<input autoFocus maxLength={160} minLength={2} onChange={(event) => { const next = event.target.value; setName(next); if (!slug || slug === slugify(name)) setSlug(slugify(next)); }} placeholder="Captação de mandato" required value={name} /></label><label>Endereço público<div className={styles.slugField}><span>/f/</span><input maxLength={120} minLength={3} onChange={(event) => setSlug(slugify(event.target.value))} pattern="[a-z0-9][a-z0-9-]{2,119}" required value={slug} /></div></label>{error ? <p className={styles.error} role="alert">{error}</p> : null}<footer><Button disabled={busy} onClick={() => setCreating(false)} type="button" variant="secondary">Cancelar</Button><Button disabled={busy || name.length < 2 || slug.length < 3} type="submit">{busy ? "Criando…" : "Criar e editar"}</Button></footer></form></AccessibleDialog> : null}
  </section>;
}
