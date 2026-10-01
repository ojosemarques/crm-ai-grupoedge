"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { type CopilotAction, type CopilotActionOptions, type CopilotActionPreview } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import styles from "./copilot-drawer.module.css";

type SalePreview = Readonly<{
  customerName: string; sellerName: string; contractTemplateName: string; summary: string;
  customer?: { mode: "CREATE" | "LINK" | "EXISTING"; name: string };
  pendingSteps: readonly string[];
  payload: Readonly<{ totalCents: string; upfrontCents: string; monthlyCents: string; durationMonths: number; startsAt: string; acceptance?: { acceptedByName: string; acceptedByRole: string; evidenceText: string } }>;
  schedule: readonly Readonly<{ installment: number; amountCents: string; dueAt: string }>[];
}>;
type PlanPreview = Readonly<{
  kind: "ACTION_PLAN"; title: string; summary: string; atomic: true;
  steps: readonly Readonly<{ position: number; kind: CopilotAction["kind"] | "CLOSE_SALE"; preview: SalePreview | CopilotActionPreview }>[];
  impact: readonly string[];
}>;
type ProposalPreview = SalePreview | CopilotActionPreview | PlanPreview;
type Proposal = Readonly<{ id: string; type: string; revision: number; expiresAt: string; preview: ProposalPreview; resuming?: boolean }>;
type QueryResult = Readonly<{ answer: string; proposal: Proposal | null; links: readonly Readonly<{ label: string; href: string; entityType: string }>[] }>;
type HistoryItem = Readonly<{ id: string; type: string; status: string; preview: ProposalPreview; createdAt: string; approvedAt: string | null; cancelledAt: string | null }>;
type Screen = { mode: "LOCAL" | "OPENAI"; pending: Proposal[]; history: HistoryItem[]; options: CopilotActionOptions };
type Message = Readonly<{ id: string; role: "USER" | "COPILOT"; text: string; result?: QueryResult }>;

const suggestions = [
  "Quero cadastrar um lead. Pergunte os dados necessários.",
  "Quero mover um lead no pipeline. Ajude a localizar o cadastro e a etapa.",
  "Quero registrar uma entrada ou despesa no financeiro.",
  "Faça meu resumo do dia e indique a próxima ação.",
  "Quais leads precisam de atenção ou estão sem contato recente?",
  "Quais negócios estão parados e por quê?",
  "Qual é a previsão de fechamento?",
  "Explique a queda nas vendas comparando com o período anterior.",
  "Resuma caixa, despesas, recebíveis e MRR.",
  "Prepare os briefings das próximas reuniões.",
  "Qual atividade devo executar agora?",
];
const labels: Record<CopilotAction["kind"] | "CLOSE_SALE" | "ACTION_PLAN", string> = { CREATE_LEAD: "Cadastrar lead", MOVE_LEAD: "Mover lead", CREATE_CUSTOMER: "Cadastrar cliente", CREATE_INCOME: "Registrar entrada", CREATE_INDICATOR: "Criar indicador", CREATE_TASK: "Criar tarefa", UPDATE_CUSTOMER: "Atualizar cliente", CREATE_EXPENSE: "Registrar despesa", RECORD_PAYMENT: "Registrar recebimento", CLOSE_SALE: "Fechar venda", ACTION_PLAN: "Plano de ações" };
const statusLabels: Record<string, string> = { DRAFT: "Aguardando confirmação", EXECUTING: "Confirmação em andamento", EXECUTION_FAILED: "Recuperação disponível", PUBLISHED: "Executada", CANCELLED: "Cancelada", EXPIRED: "Expirada" };
const currency = (cents: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
function PreviewDetails({ preview }: Readonly<{ preview: ProposalPreview }>) {
  if ("kind" in preview && preview.kind === "ACTION_PLAN") return <>
    <strong>{preview.title}</strong><p>{preview.summary}</p>
    <p className={styles.planNotice}>Revise as {preview.steps.length} etapas abaixo. Uma confirmação executa o plano inteiro. Se alguma etapa falhar, nenhuma alteração do plano será salva.</p>
    <ol aria-label="Etapas do plano" className={styles.planSteps}>{preview.steps.map((step) => <li key={step.position}><div className={styles.stepHeading}><span>{step.position}</span><strong>{labels[step.kind]}</strong></div><PreviewDetails preview={step.preview} /></li>)}</ol>
    {preview.impact.length ? <ul>{preview.impact.map((impact) => <li key={impact}>{impact}</li>)}</ul> : null}
  </>;
  if ("kind" in preview) return <>
    <strong>{preview.title}</strong><p>{preview.summary}</p>
    <dl>{preview.details.map((detail, index) => <div key={`${index}:${detail.label}`}><dt>{detail.label}</dt><dd>{detail.before !== undefined ? <><span className={styles.before}>{detail.before}</span><span aria-label="alterar para"> → </span></> : null}{detail.after}</dd></div>)}</dl>
    <ul>{preview.impact.map((impact) => <li key={impact}>{impact}</li>)}</ul>
  </>;
  return <>
    <p>{preview.summary}</p>
    <dl>
      <div><dt>Cliente</dt><dd>{preview.customerName}{preview.customer?.mode === "CREATE" ? " (novo cadastro)" : ""}</dd></div>
      <div><dt>Vendedor</dt><dd>{preview.sellerName}</dd></div>
      <div><dt>Valor total</dt><dd>{currency(preview.payload.totalCents)}</dd></div>
      <div><dt>Entrada</dt><dd>{currency(preview.payload.upfrontCents)}</dd></div>
      <div><dt>Mensalidade / prazo</dt><dd>{currency(preview.payload.monthlyCents)} × {preview.payload.durationMonths} meses</dd></div>
      <div><dt>Início</dt><dd>{date(preview.payload.startsAt)}</dd></div>
      <div><dt>Contrato</dt><dd>{preview.contractTemplateName}</dd></div>
    </dl>
    {preview.payload.acceptance ? <p><strong>Aceite informado:</strong> {preview.payload.acceptance.acceptedByName} ({preview.payload.acceptance.acceptedByRole}) — {preview.payload.acceptance.evidenceText}</p> : <p>Contrato em rascunho: aceite do cliente ainda pendente.</p>}
    <details><summary>Cronograma de cobranças</summary><ol>{preview.schedule.map((item) => <li key={item.installment}>{date(item.dueAt)} — {currency(item.amountCents)}</li>)}</ol></details>
    {preview.pendingSteps.length ? <ul>{preview.pendingSteps.map((step) => <li key={step}>{step}</li>)}</ul> : null}
  </>;
}

export function CopilotDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [tab, setTab] = useState<"chat" | "history">("chat");
  const [refreshCount, setRefreshCount] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setRefreshCount((current) => current + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch("/api/ai/copilot", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { result?: Screen; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar as ações e o histórico.");
      if (!active) return;
      const result = body.result;
      setScreen(result);
      setMessages((current) => [
        ...current.map((message) => {
          const updated = result.pending.find((proposal) => proposal.id === message.result?.proposal?.id);
          return updated && message.result ? { ...message, result: { ...message.result, proposal: updated } } : message;
        }),
        ...result.pending.filter((proposal) => !current.some((message) => message.result?.proposal?.id === proposal.id)).map((proposal): Message => ({ id: proposal.id, role: "COPILOT", text: proposal.resuming ? "Recupere o resultado da confirmação anterior. A mesma ação não será duplicada." : "Você tem uma proposta aguardando revisão.", result: { answer: "", proposal, links: [] } })),
      ]);
      setResolvedProposals((current) => [...new Set([...current, ...result.history.filter((item) => ["PUBLISHED", "CANCELLED", "EXPIRED"].includes(item.status)).map((item) => item.id)])]);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar o Copilot."); });
    return () => { active = false; };
  }, [open, refreshCount]);

  async function send(command: unknown): Promise<QueryResult> {
    const response = await fetch("/api/ai/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const body = await response.json() as { result?: QueryResult; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível concluir a solicitação.");
    return body.result;
  }
  const append = (result: QueryResult) => setMessages((current) => [...current, { id: crypto.randomUUID(), role: "COPILOT", text: result.answer, result }]);

  async function ask(value: string) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true); setError(null); setQuestion("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "USER", text: prompt }]);
    try {
      append(await send({ action: "CHAT", message: prompt, history: messages.slice(-12).map((message) => ({ role: message.role === "USER" ? "user" : "assistant", content: message.text.slice(0, 6000) })) }));
      setRefreshCount((count) => count + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível consultar o Copilot."); }
    finally { setBusy(false); }
  }

  async function decide(proposal: Proposal, action: "CONFIRM" | "CANCEL") {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await send({ action, proposalId: proposal.id, expectedRevision: proposal.revision, ...(action === "CONFIRM" ? { confirmed: true } : {}) });
      setResolvedProposals((current) => [...current, proposal.id]); append(result);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao confirmar a proposta."); }
    finally { setBusy(false); setRefreshCount((count) => count + 1); }
  }

  return <aside aria-hidden={!open} aria-label="Chat do Copilot" className={styles.drawer} data-open={open} id="copilot-drawer" inert={!open}>
    <header className={styles.header}><span className={styles.copilotIcon}><Icon name="copilot" size={18} /></span><div><strong>Copilot</strong><small>{screen?.mode === "LOCAL" ? "Consultas e ações locais" : "Dados autorizados do CRM"}</small></div><button aria-label="Fechar Copilot" className={styles.close} onClick={onClose} type="button">×</button></header>
    <nav aria-label="Seções do Copilot" className={styles.tabs}>{([['chat', 'Conversas'], ['history', 'Histórico']] as const).map(([value, label]) => <button aria-current={tab === value ? "page" : undefined} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</nav>
    <div className={styles.conversation}>
      {tab === "history" ? <>
        <p className={styles.panelDescription}>Suas últimas 30 propostas autorizadas ficam salvas nesta empresa, incluindo confirmações e cancelamentos.</p>
        <button className={styles.refreshButton} disabled={busy} onClick={() => setRefreshCount((count) => count + 1)} type="button">Atualizar histórico</button>
        {screen?.history.length ? screen.history.map((item) => <article className={styles.historyItem} data-proposal-id={item.id} key={item.id}><strong>{labels[item.type as keyof typeof labels] ?? item.type}</strong><span>{statusLabels[item.status] ?? item.status}</span><small>Criada em {dateTime(item.createdAt)}{item.approvedAt ? ` · Confirmada em ${dateTime(item.approvedAt)}` : ""}{item.cancelledAt ? ` · Cancelada em ${dateTime(item.cancelledAt)}` : ""}</small><details><summary>Ver dados e efeitos</summary><div className={styles.proposal}><PreviewDetails preview={item.preview} /></div></details>{["DRAFT", "EXECUTING", "EXECUTION_FAILED"].includes(item.status) ? <button onClick={() => setTab("chat")} type="button">Revisar na conversa</button> : null}</article>) : <p className={styles.panelDescription}>{screen ? "Nenhuma proposta no seu histórico." : "Carregando histórico…"}</p>}
      </> : null}
      {tab === "chat" ? <div aria-live="polite">
        {!messages.length ? <div className={styles.welcome}><span><Icon name="copilot" size={24} /></span><strong>Como posso ajudar?</strong><p>Converse para consultar dados, cadastrar leads e clientes, mover etapas ou registrar lançamentos. Eu preparo a prévia e você confirma aqui.</p><div className={styles.suggestions}>{suggestions.map((suggestion) => <button disabled={busy} key={suggestion} onClick={() => void ask(suggestion)} type="button">{suggestion}</button>)}</div></div> : messages.map((message) => <article className={styles.message} data-role={message.role} key={message.id}><div>{message.text}</div>{message.result?.proposal ? (() => {
          const original = message.result.proposal;
          const proposal = screen?.pending.find((item) => item.id === original.id) ?? original;
          const history = screen?.history.find((item) => item.id === original.id && ["PUBLISHED", "CANCELLED", "EXPIRED"].includes(item.status));
          const isPlan = proposal.type === "ACTION_PLAN";
          const resolved = resolvedProposals.includes(proposal.id);
          const expired = !proposal.resuming && Date.now() >= new Date(proposal.expiresAt).getTime();
          return <section aria-label={isPlan ? "Prévia do plano" : "Prévia da ação"} className={styles.proposal} data-proposal-id={proposal.id}><strong>Revise antes de confirmar</strong><PreviewDetails preview={history && resolved ? history.preview : proposal.preview} /><p>{resolved ? statusLabels[history?.status ?? ""] ?? "Proposta finalizada." : proposal.resuming ? "Recupere a confirmação anterior com a mesma proposta." : expired ? "Prévia expirada. Prepare uma nova proposta com dados atualizados." : `Prévia válida até ${dateTime(proposal.expiresAt)}.`}</p>{resolved ? <small>Proposta finalizada. Consulte o histórico.</small> : <div className={styles.proposalActions}><button disabled={busy || expired} onClick={() => void decide(proposal, "CONFIRM")} type="button">{proposal.resuming ? "Recuperar resultado" : isPlan ? "Confirmar plano" : "Confirmar ação"}</button>{!proposal.resuming ? <button disabled={busy} onClick={() => void decide(proposal, "CANCEL")} type="button">{isPlan ? "Cancelar plano" : "Cancelar"}</button> : null}</div>}</section>;
        })() : null}{message.result?.links.length ? <div className={styles.links}>{message.result.links.slice(0, 5).map((link) => <Link href={link.href} key={`${link.entityType}:${link.href}`} onClick={onClose}>{link.label}<span>↗</span></Link>)}</div> : null}</article>)}
        {busy ? <div className={styles.typing} role="status"><span /><span /><span /><small>Copilot processando</small></div> : null}<div ref={endRef} />
      </div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
    {tab === "chat" ? <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}><textarea aria-label="Pergunte ao Copilot" maxLength={4_000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(question); } }} placeholder="Pergunte ou solicite uma ação…" ref={inputRef} rows={2} value={question} /><button aria-label="Enviar pergunta" disabled={busy || !question.trim()} type="submit"><Icon name="mais" size={16} /></button><small>Enter para enviar · Alterações exigem confirmação na prévia</small></form> : <footer className={styles.footer}>Toda ação confirmada fica no histórico desta empresa.</footer>}
  </aside>;
}
