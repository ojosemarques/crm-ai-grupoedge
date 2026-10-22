"use client";

import { useEffect, useState, type FormEvent } from "react";

import styles from "@/app/formularios/[formId]/marketing-form-builder.module.css";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type ResponseItem = Readonly<{
  publicId: string;
  status: string;
  version: number | null;
  submittedAt: string;
  utmSource: string | null;
  submission: Readonly<{ submittedFullName: string | null; submittedEmail: string | null; submittedPhone: string | null; leadId: string | null; intakeOutcome: string | null }> | null;
}>;
type ResponseDetail = Readonly<{
  receipt: Readonly<{ publicId: string; status: string; submittedAt: string; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrerHost: string | null }>;
  version: number;
  submission: Readonly<{ leadId: string | null; contactId: string | null; intakeOutcome: string | null }> | null;
  answers: readonly { questionKey: string; question: string; displayValue: string }[];
}>;
type Statistics = Readonly<{ views: number; starts: number; completed: number; completionRate: number | null; medianSeconds: number | null; abandonment: readonly { questionKey: string; viewed: number; abandoned: number }[]; choices: readonly { version: number; questionKey: string; optionKey: string; total: number }[]; grain: string }>;

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar os dados.");
  return body.result;
}

export function ResponsesPanel({ formId }: Readonly<{ formId: string }>) {
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; versions: readonly number[]; permissions: Readonly<{ delete: boolean }>; items: readonly ResponseItem[] } | null>(null);
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResponseItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", status: "", version: "", utmSource: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (applied.search) query.set("search", applied.search);
    if (applied.status) query.set("status", applied.status);
    if (applied.version) query.set("version", applied.version);
    if (applied.utmSource) query.set("utmSource", applied.utmSource);
    if (applied.from) query.set("from", new Date(`${applied.from}T00:00:00`).toISOString());
    if (applied.to) query.set("to", new Date(`${applied.to}T23:59:59.999`).toISOString());
    void getJson<{ total: number; page: number; pageSize: number; versions: readonly number[]; permissions: Readonly<{ delete: boolean }>; items: readonly ResponseItem[] }>(`/api/marketing/forms/${formId}/responses?${query}`)
      .then((result) => { if (active) setData(result); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar."); });
    return () => { active = false; };
  }, [applied, formId, page]);
  function applyFilters(event: FormEvent) { event.preventDefault(); setError(null); setPage(1); setApplied({ ...filters, search: filters.search.trim() }); }
  async function open(publicId: string) { setError(null); try { setDetail(await getJson<ResponseDetail>(`/api/marketing/forms/${formId}/responses/${publicId}`)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao carregar."); } }
  async function remove() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const removed = await getJson<{ publicId: string; leadPreserved: boolean }>(`/api/marketing/forms/${formId}/responses/${deleteTarget.publicId}`, { method: "DELETE" });
      const shouldGoBack = page > 1 && data?.items.length === 1;
      setData((current) => current ? { ...current, total: Math.max(0, current.total - 1), items: current.items.filter((item) => item.publicId !== deleteTarget.publicId) } : null);
      setDeleteTarget(null);
      setNotice(removed.leadPreserved ? "Resposta excluída. O lead vinculado foi preservado no CRM." : "Resposta incompleta excluída.");
      if (shouldGoBack) setPage((current) => Math.max(1, current - 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao excluir a resposta.");
    } finally {
      setDeleting(false);
    }
  }
  const exportQuery = new URLSearchParams();
  if (applied.search) exportQuery.set("search", applied.search);
  if (applied.status) exportQuery.set("status", applied.status);
  if (applied.version) exportQuery.set("version", applied.version);
  if (applied.utmSource) exportQuery.set("utmSource", applied.utmSource);
  if (applied.from) exportQuery.set("from", new Date(`${applied.from}T00:00:00`).toISOString());
  if (applied.to) exportQuery.set("to", new Date(`${applied.to}T23:59:59.999`).toISOString());
  return <>
    <form className={`${styles.reportToolbar} ${styles.reportFilters}`} onSubmit={applyFilters}>
      <label className={styles.searchField}>Pesquisar<input maxLength={120} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Nome ou telefone" type="search" value={filters.search} /></label>
      <label>Status<select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}><option value="">Todos</option><option value="INCOMPLETO">Incompleto</option><option value="ACCEPTED">Aceita</option><option value="FAILED">Falhou</option><option value="PROCESSING">Processando</option><option value="RECEIVED">Recebida</option></select></label>
      <label>Versão<select onChange={(event) => setFilters((current) => ({ ...current, version: event.target.value }))} value={filters.version}><option value="">Todas</option>{data?.versions.map((version) => <option key={version} value={version}>v{version}</option>)}</select></label>
      <label>Origem UTM<input maxLength={200} onChange={(event) => setFilters((current) => ({ ...current, utmSource: event.target.value }))} value={filters.utmSource} /></label>
      <label>De<input onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} type="date" value={filters.from} /></label>
      <label>Até<input onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} type="date" value={filters.to} /></label>
      <button type="submit">Filtrar</button>
      <a href={`/api/marketing/forms/${formId}/responses/export${exportQuery.size ? `?${exportQuery}` : ""}`}>Exportar CSV</a>
    </form>
    <div className={styles.reportToolbar}><span>{data ? `${data.total} resposta${data.total === 1 ? "" : "s"}` : "Carregando…"}</span></div>
    {notice ? <p className={styles.reportSuccess} role="status">{notice}</p> : null}
    {error ? <p className={styles.reportError} role="alert">{error}</p> : null}
    {data?.items.length ? <><div className={styles.tableWrap}><table className={styles.responsesTable}><thead><tr><th>Recebida</th><th>Pessoa</th><th>Contato</th><th>Versão</th><th>Origem</th><th>Status</th><th><span className={styles.srOnly}>Ações</span></th></tr></thead><tbody>{data.items.map((item) => <tr key={item.publicId}><td>{new Date(item.submittedAt).toLocaleString("pt-BR")}</td><td>{item.submission?.submittedFullName ?? "—"}</td><td>{item.submission?.submittedEmail ?? item.submission?.submittedPhone ?? "—"}</td><td>v{item.version ?? "—"}</td><td>{item.utmSource ?? "Não atribuída"}</td><td>{item.status}</td><td><div className={styles.responseActions}><button onClick={() => void open(item.publicId)} type="button">Ver resposta</button>{data.permissions.delete ? <button aria-label={`Excluir resposta de ${item.submission?.submittedFullName ?? new Date(item.submittedAt).toLocaleString("pt-BR")}`} className={styles.deleteResponseButton} disabled={deleting} onClick={() => { setError(null); setNotice(null); setDeleteTarget(item); }} title="Excluir resposta" type="button"><Icon name="lixeira" size={16} /></button> : null}</div></td></tr>)}</tbody></table></div><nav aria-label="Páginas de respostas" className={styles.reportToolbar}><button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Anterior</button><span>Página {page}</span><button disabled={page * data.pageSize >= data.total} onClick={() => setPage((current) => current + 1)} type="button">Próxima</button></nav></> : data ? <div className={styles.placeholder}>Nenhuma resposta recebida.</div> : null}
    {detail ? <AccessibleDialog backdropClassName={styles.modalBackdrop!} className={styles.responseModal!} labelledBy="response-title" onDismiss={() => setDetail(null)}><header><div><h3 id="response-title">Resposta v{detail.version}</h3><p>{new Date(detail.receipt.submittedAt).toLocaleString("pt-BR")} · {detail.receipt.status}</p></div><button aria-label="Fechar" onClick={() => setDetail(null)} type="button">×</button></header><dl className={styles.responseMeta}><div><dt>UTM source</dt><dd>{detail.receipt.utmSource ?? "—"}</dd></div><div><dt>UTM campaign</dt><dd>{detail.receipt.utmCampaign ?? "—"}</dd></div><div><dt>Lead</dt><dd>{detail.submission?.leadId ?? "—"}</dd></div></dl><div className={styles.answerList}>{detail.answers.map((answer) => <article key={answer.questionKey}><span>{answer.question}</span><strong>{answer.displayValue}</strong></article>)}</div></AccessibleDialog> : null}
    {deleteTarget ? <AccessibleDialog backdropClassName={styles.modalBackdrop!} busy={deleting} className={styles.deleteResponseDialog!} describedBy="delete-response-description" labelledBy="delete-response-title" onDismiss={() => setDeleteTarget(null)}><h3 id="delete-response-title">Excluir esta resposta?</h3><p id="delete-response-description">{deleteTarget.status === "INCOMPLETO" ? "A resposta incompleta será removida da lista e não existe lead vinculado a ela." : "A resposta será removida dos relatórios, exportações e estatísticas. O lead criado no CRM será preservado."}</p><div className={styles.deleteResponseActions}><Button disabled={deleting} onClick={() => setDeleteTarget(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={deleting} onClick={() => void remove()} type="button" variant="destructive">{deleting ? "Excluindo…" : "Excluir resposta"}</Button></div></AccessibleDialog> : null}
  </>;
}

export function StatisticsPanel({ formId }: Readonly<{ formId: string }>) {
  const [data, setData] = useState<Statistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void getJson<Statistics>(`/api/marketing/forms/${formId}/statistics`).then((result) => { if (active) setData(result); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar."); }); return () => { active = false; }; }, [formId]);
  if (error) return <p className={styles.reportError} role="alert">{error}</p>;
  if (!data) return <div className={styles.placeholder}>Carregando estatísticas…</div>;
  return <><div className={styles.stats}><article><span>Visualizações únicas</span><strong>{data.views}</strong></article><article><span>Inícios únicos</span><strong>{data.starts}</strong></article><article><span>Conclusões</span><strong>{data.completed}</strong></article><article><span>Taxa de conclusão</span><strong>{data.completionRate === null ? "—" : `${data.completionRate.toLocaleString("pt-BR")}%`}</strong></article></div><p className={styles.statsNote}>Mediana até envio: {data.medianSeconds === null ? "—" : `${Math.round(data.medianSeconds)}s`} · Grão: {data.grain}</p><div className={styles.breakdowns}><section><h3>Abandono por pergunta</h3>{data.abandonment.length ? data.abandonment.map((item) => <div key={item.questionKey}><code>{item.questionKey}</code><span>{item.abandoned} de {item.viewed}</span></div>) : <p>Sem base.</p>}</section><section><h3>Escolhas por versão</h3>{data.choices.length ? data.choices.map((item) => <div key={`${item.version}:${item.questionKey}:${item.optionKey}`}><code>v{item.version} · {item.questionKey} · {item.optionKey}</code><span>{item.total}</span></div>) : <p>Sem respostas fechadas.</p>}</section></div></>;
}
