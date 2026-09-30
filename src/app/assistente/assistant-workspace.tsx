"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import styles from "./assistant-workspace.module.css";

type PeriodPreset = "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM";
type ProposalType = "AGENT" | "PIPELINE_MODEL" | "AUTOMATION" | "CHART";
type Proposal = Readonly<{
  id: string;
  type: ProposalType;
  status: "DRAFT" | "PUBLISHING" | "PUBLISH_FAILED" | "CANCELLED" | "PUBLISHED" | "UNDOING" | "UNDO_FAILED" | "UNDONE";
  request: string;
  diff: readonly Readonly<{ path: string; label: string; before: string | null; after: string }>[];
  impact: readonly string[];
  preview: Readonly<{ title: string; summary: string; fields: readonly Readonly<{ label: string; value: string }>[] }>;
  revision: number;
  publishedTarget: Readonly<{ type: string; id: string | null; versionId: string | null }> | null;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AssistantScreen = Readonly<{
  generatedAt: string;
  capabilities: Readonly<{ canQuery: boolean; canPropose: boolean; canApprove: boolean; canUndo: boolean }>;
  voiceGate: Readonly<{ enabled: false; status: "BLOCKED_PENDING_EVALUATION"; checks: readonly Readonly<{ key: string; label: string; passed: boolean }>[] }>;
  periods: readonly PeriodPreset[];
  proposalTypes: readonly Readonly<{ key: ProposalType; label: string }>[];
  proposals: readonly Proposal[];
}>;

type QueryResult = Readonly<{
  classification: Readonly<{ data: readonly string[]; inference: readonly string[]; absence: readonly string[] }>;
  answer: Readonly<{
    directAnswer: string;
    period: Readonly<{ fromDate: string; toDate: string; timeZone?: string }>;
    formula: string;
    numbers: readonly Readonly<{ label: string; value: number | null; unit?: string }>[];
    confidence: Readonly<{ valueBps?: number; value?: number; label: string; reason?: string }>;
  }> | null;
  sources: readonly Readonly<{ label: string; kind: string }>[];
  links: readonly Readonly<{ label: string; href: string; entityType: string }>[];
  permissionScope: string;
}>;

const periodLabels: Record<PeriodPreset, string> = { TODAY: "Hoje", YESTERDAY: "Ontem", WEEK: "Semana atual", MONTH: "Mês atual", CUSTOM: "Personalizado" };
const statusLabels: Record<Proposal["status"], string> = { DRAFT: "Rascunho", PUBLISHING: "Publicando", PUBLISH_FAILED: "Falha ao publicar · revisão necessária", CANCELLED: "Cancelada sem efeito", PUBLISHED: "Publicada", UNDOING: "Desfazendo", UNDO_FAILED: "Falha ao desfazer · revisão necessária", UNDONE: "Desfeita" };

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function number(value: number | null, unit?: string) {
  if (value === null) return "Sem dado";
  if (unit === "CURRENCY_CENTS") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
  if (unit === "PERCENTAGE" || unit === "BASIS_POINTS") return `${(unit === "BASIS_POINTS" ? value / 100 : value).toLocaleString("pt-BR")}%`;
  return value.toLocaleString("pt-BR");
}

export function AssistantWorkspace({ initial }: Readonly<{ initial: AssistantScreen }>) {
  const [screen, setScreen] = useState(initial);
  const [tab, setTab] = useState<"QUERY" | "CREATE">("QUERY");
  const [question, setQuestion] = useState("Quais oportunidades estão paradas sem movimentação no período?");
  const [preset, setPreset] = useState<PeriodPreset>("MONTH");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [request, setRequest] = useState("Crie um agente de triagem com base aprovada, orçamento limitado e handoff humano.");
  const [proposalType, setProposalType] = useState<ProposalType | "">("AGENT");
  const [selectedProposalId, setSelectedProposalId] = useState(initial.proposals[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const selected = screen.proposals.find((proposal) => proposal.id === selectedProposalId) ?? screen.proposals[0];

  async function refresh(preferredId?: string) {
    const response = await fetch("/api/ai/assistant", { cache: "no-store" });
    const body = await response.json() as { result?: AssistantScreen; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível atualizar o Assistente.");
    setScreen(body.result);
    setSelectedProposalId(preferredId || selectedProposalId || body.result.proposals[0]?.id || "");
  }

  async function post<T>(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "A solicitação não foi concluída.");
    return body.result;
  }

  async function query(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("QUERY"); setNotice(null); setQueryResult(null);
    try {
      const result = await post<QueryResult>("QUERY", { question, preset, ...(preset === "CUSTOM" ? { fromDate, toDate } : {}) });
      setQueryResult(result); setNotice({ tone: "success", text: "Consulta concluída com período, permissão e evidências explícitas." });
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A consulta não foi concluída." }); }
    finally { setBusy(null); }
  }

  async function propose(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("PROPOSE"); setNotice(null);
    try {
      const proposal = await post<Proposal>("PROPOSE", { request, ...(proposalType ? { type: proposalType } : {}) });
      await refresh(proposal.id); setSelectedProposalId(proposal.id); setNotice({ tone: "success", text: "Prévia criada em rascunho. Nenhuma configuração foi publicada." });
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A prévia não foi criada." }); }
    finally { setBusy(null); }
  }

  async function transition(action: "CANCEL" | "APPROVE" | "UNDO", proposal: Proposal) {
    setBusy(action); setNotice(null);
    const reason = action === "CANCEL" ? "Rascunho descartado sem aplicar alterações." : action === "APPROVE" ? "Prévia e impacto revisados por administrador." : "Undo solicitado após revisão da versão publicada.";
    try {
      await post(action, { proposalId: proposal.id, reason, ...(action === "UNDO" ? {} : { expectedRevision: proposal.revision }) });
      await refresh(proposal.id);
      setNotice({ tone: "success", text: action === "CANCEL" ? "Rascunho cancelado sem efeito." : action === "APPROVE" ? "Configuração publicada pelo serviço de domínio." : "Undo publicado e auditado." });
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A transição não foi concluída." }); }
    finally { setBusy(null); }
  }

  const draftCount = screen.proposals.filter((proposal) => proposal.status === "DRAFT").length;
  const publishedCount = screen.proposals.filter((proposal) => proposal.status === "PUBLISHED").length;
  return <div className="space-y-5">
    <Surface tone="critical"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader eyebrow="Canal de voz" title="Voz bloqueada até avaliação" description="Qualidade, transcrição, privacidade e custo precisam ser aprovados antes de qualquer captura ou reprodução de áudio." /><span className="status-badge" data-tone="danger">{screen.voiceGate.status}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{screen.voiceGate.checks.map((check) => <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-card p-3 text-sm" key={check.key}><span>{check.label}</span><span className="status-badge" data-tone={check.passed ? "success" : "warning"}>{check.passed ? "Aprovado" : "Pendente"}</span></div>)}</div></Surface>
    <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Rascunhos" value={draftCount} hint="Ainda sem efeito" /><StatCard label="Publicadas" value={publishedCount} hint="Com versão e auditoria" /><StatCard label="Voz" value="Bloqueada" hint="Sem captura de áudio" /></div>
    <div className="flex flex-wrap gap-2" role="tablist"><Button onClick={() => setTab("QUERY")} role="tab" variant={tab === "QUERY" ? "default" : "secondary"}>Consultar operação</Button><Button onClick={() => setTab("CREATE")} role="tab" variant={tab === "CREATE" ? "default" : "secondary"}>Criar configuração</Button></div>
    {notice ? <p className="feedback-banner" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p> : null}

    {tab === "QUERY" ? <><Surface><SectionHeader title="Pergunta gerencial em linguagem natural" description="A resposta usa catálogo canônico, período e escopo autorizado. Dados, inferências e ausências permanecem separados." /><form className="mt-4 grid gap-4 md:grid-cols-4" onSubmit={query}><label className="space-y-1 text-sm md:col-span-3"><span className="font-semibold">Pergunta</span><textarea className={`${styles.input} min-h-24`} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} required value={question} /></label><label className="space-y-1 text-sm"><span className="font-semibold">Período</span><select className={styles.input} onChange={(event) => setPreset(event.target.value as PeriodPreset)} value={preset}>{screen.periods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></label>{preset === "CUSTOM" ? <><label className="space-y-1 text-sm"><span className="font-semibold">Data inicial</span><input className={styles.input} onChange={(event) => setFromDate(event.target.value)} required type="date" value={fromDate} /></label><label className="space-y-1 text-sm"><span className="font-semibold">Data final</span><input className={styles.input} onChange={(event) => setToDate(event.target.value)} required type="date" value={toDate} /></label></> : null}<div className="flex items-end md:col-span-4"><Button disabled={busy !== null || !screen.capabilities.canQuery} type="submit">{busy === "QUERY" ? "Consultando…" : "Consultar dados autorizados"}</Button></div></form></Surface>{queryResult ? <QueryEvidence result={queryResult} /> : <EmptyState description="Faça uma pergunta para receber fatos, inferências, ausências e links rastreáveis." title="Nenhuma consulta executada" />}</> : null}

    {tab === "CREATE" ? <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]"><div className="space-y-5"><Surface><SectionHeader title="Pedido de configuração" description="O pedido gera apenas uma prévia estruturada em rascunho. Aprovação administrativa é uma etapa separada." /><form className="mt-4 space-y-4" onSubmit={propose}><label className="space-y-1 text-sm"><span className="font-semibold">Tipo</span><select className={styles.input} onChange={(event) => setProposalType(event.target.value as ProposalType | "")} value={proposalType}><option value="">Inferir com segurança</option>{screen.proposalTypes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="space-y-1 text-sm"><span className="font-semibold">O que deseja configurar?</span><textarea className={`${styles.input} min-h-32`} maxLength={4000} onChange={(event) => setRequest(event.target.value)} required value={request} /></label><Button disabled={busy !== null || !screen.capabilities.canPropose} type="submit">{busy === "PROPOSE" ? "Preparando…" : "Gerar prévia em rascunho"}</Button></form></Surface><Surface><SectionHeader title="Histórico de propostas" description="Selecione uma prévia para revisar diff, impacto e versão." /><div className="mt-4 space-y-2">{screen.proposals.map((proposal) => <button className={`w-full rounded-[var(--radius-control)] border p-3 text-left ${selected?.id === proposal.id ? "border-primary bg-[var(--surface-subtle)]" : "bg-card"}`} key={proposal.id} onClick={() => setSelectedProposalId(proposal.id)} type="button"><span className="flex items-center justify-between gap-2"><strong className="text-sm">{proposal.preview.title}</strong><span className="status-badge" data-tone={proposal.status === "PUBLISHED" ? "success" : proposal.status === "PUBLISH_FAILED" || proposal.status === "UNDO_FAILED" ? "danger" : proposal.status === "DRAFT" ? "info" : "warning"}>{statusLabels[proposal.status]}</span></span><span className="mt-1 block text-xs text-muted-foreground">{date(proposal.updatedAt)} · revisão {proposal.revision}</span></button>)}{screen.proposals.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma proposta criada.</p> : null}</div></Surface></div>{selected ? <ProposalPreview busy={busy} canApprove={screen.capabilities.canApprove} canUndo={screen.capabilities.canUndo} proposal={selected} transition={transition} /> : <EmptyState description="Gere um rascunho para revisar sua prévia." title="Sem proposta selecionada" />}</div> : null}
  </div>;
}

function QueryEvidence({ result }: Readonly<{ result: QueryResult }>) {
  const answer = result.answer;
  const confidence = answer ? answer.confidence.valueBps !== undefined ? answer.confidence.valueBps / 100 : (answer.confidence.value ?? 0) * 100 : null;
  return <Surface><div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader eyebrow="Resposta classificada" title={answer?.directAnswer ?? "A métrica solicitada não está homologada"} description={answer ? `${answer.period.fromDate} a ${answer.period.toDate}${answer.period.timeZone ? ` · ${answer.period.timeZone}` : ""}` : "A ausência foi registrada sem fabricar uma resposta."} /><div className="flex gap-2"><span className="status-badge">{result.permissionScope}</span>{answer && confidence !== null ? <span className="status-badge" data-tone="info">{answer.confidence.label} · {confidence.toLocaleString("pt-BR")}%</span> : null}</div></div>{answer ? <><p className="mt-4 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3 text-sm"><strong>Fórmula:</strong> {answer.formula}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{answer.numbers.map((item) => <article className="rounded-[var(--radius-control)] border p-3" key={item.label}><p className="text-xs text-muted-foreground">{item.label}</p><strong className="mt-1 block text-xl">{number(item.value, item.unit)}</strong></article>)}</div></> : null}<div className="mt-5 grid gap-4 lg:grid-cols-3"><Classification label="Dados" items={result.classification.data} tone="success" /><Classification label="Inferências" items={result.classification.inference} tone="warning" /><Classification label="Ausências" items={result.classification.absence} tone="danger" /></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 className="font-semibold">Fontes canônicas</h3><ul className="mt-2 space-y-2 text-sm">{result.sources.map((source) => <li className="rounded-[var(--radius-control)] border p-3" key={`${source.kind}:${source.label}`}><span className="status-badge">{source.kind}</span><span className="ml-2">{source.label}</span></li>)}</ul></div><div><h3 className="font-semibold">Registros relacionados</h3>{result.links.length ? <ul className="mt-2 space-y-2">{result.links.map((link) => <li key={`${link.entityType}:${link.href}`}><Link className="flex items-center justify-between rounded-[var(--radius-control)] border p-3 text-sm font-semibold text-primary hover:bg-[var(--surface-subtle)]" href={link.href}><span>{link.label}</span><span>{link.entityType} →</span></Link></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhum registro autorizado neste recorte.</p>}</div></div>{answer?.confidence.reason ? <p className="mt-4 text-xs text-muted-foreground">Confiança: {answer.confidence.reason}</p> : null}</Surface>;
}

function Classification({ items, label, tone }: Readonly<{ items: readonly string[]; label: string; tone: "success" | "warning" | "danger" }>) {
  return <section className="rounded-[var(--radius-panel)] border p-4"><span className="status-badge" data-tone={tone}>{label}</span>{items.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nenhum item.</p>}</section>;
}

function ProposalPreview({ busy, canApprove, canUndo, proposal, transition }: Readonly<{ busy: string | null; canApprove: boolean; canUndo: boolean; proposal: Proposal; transition: (action: "CANCEL" | "APPROVE" | "UNDO", proposal: Proposal) => Promise<void> }>) {
  return <Surface><div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader eyebrow={proposal.type} title={proposal.preview.title} description={proposal.preview.summary} /><span className="status-badge" data-tone={proposal.status === "PUBLISHED" ? "success" : proposal.status === "PUBLISH_FAILED" || proposal.status === "UNDO_FAILED" ? "danger" : proposal.status === "DRAFT" ? "info" : "warning"}>{statusLabels[proposal.status]}</span></div>{proposal.status === "PUBLISH_FAILED" || proposal.status === "UNDO_FAILED" ? <p className="feedback-banner mt-4" data-tone="danger" role="alert">{proposal.status === "PUBLISH_FAILED" ? "A publicação falhou" : "O undo falhou parcialmente"} e exige revisão humana. Nenhuma nova tentativa será executada automaticamente.</p> : null}<dl className="mt-4 grid gap-3 sm:grid-cols-2">{proposal.preview.fields.map((field) => <div className="rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3" key={field.label}><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="mt-1 text-sm font-semibold">{field.value}</dd></div>)}</dl><section className="mt-5"><h3 className="font-semibold">Diff proposto</h3><div className="mt-2 space-y-2">{proposal.diff.map((item) => <article className="rounded-[var(--radius-control)] border p-3" key={item.path}><p className="text-sm font-semibold">{item.label}</p><div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><div><span className="text-xs text-muted-foreground">Antes</span><p className="mt-1 rounded bg-red-50 p-2 text-red-900">{item.before ?? "Ausente"}</p></div><div><span className="text-xs text-muted-foreground">Depois</span><p className="mt-1 rounded bg-emerald-50 p-2 text-emerald-900">{item.after}</p></div></div></article>)}</div></section><section className="mt-5"><h3 className="font-semibold">Impacto antes da aprovação</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{proposal.impact.map((item) => <li key={item}>{item}</li>)}</ul></section>{proposal.publishedTarget ? <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3 text-sm"><strong>Alvo publicado:</strong> {proposal.publishedTarget.type} · {proposal.publishedTarget.id ?? "sem registro persistente"} · versão {proposal.publishedTarget.versionId ?? proposal.publishedVersionId ?? "local"}</p> : null}<div className="mt-5 flex flex-wrap gap-2">{proposal.status === "DRAFT" ? <><Button disabled={busy !== null} onClick={() => void transition("CANCEL", proposal)} variant="secondary">Cancelar sem efeito</Button>{canApprove ? <Button disabled={busy !== null} onClick={() => void transition("APPROVE", proposal)}>Aprovar e publicar</Button> : <span className="text-sm text-muted-foreground">A aprovação exige administrador.</span>}</> : null}{proposal.status === "PUBLISHED" && canUndo ? <Button disabled={busy !== null} onClick={() => void transition("UNDO", proposal)} variant="secondary">Desfazer publicação</Button> : null}</div></Surface>;
}
