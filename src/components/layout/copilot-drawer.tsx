"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import styles from "./copilot-drawer.module.css";

type SalePreview = Readonly<{
  customerName: string;
  sellerName: string;
  contractTemplateName: string;
  summary: string;
  pendingSteps: readonly string[];
  payload: Readonly<{ totalCents: string; upfrontCents: string; monthlyCents: string; durationMonths: number; startsAt: string; acceptance?: { acceptedByName: string; acceptedByRole: string; evidenceText: string } }>;
  schedule: readonly Readonly<{ installment: number; amountCents: string; dueAt: string }>[];
}>;
type QueryResult = Readonly<{
  answer: string;
  proposal: Readonly<{ id: string; revision: number; expiresAt: string; preview: SalePreview; resuming?: boolean }> | null;
  links: readonly Readonly<{ label: string; href: string; entityType: string }>[];
}>;

type Message = Readonly<{
  id: string;
  role: "USER" | "COPILOT";
  text: string;
  result?: QueryResult;
}>;

const suggestions = [
  "Quais leads precisam de ação hoje?",
  "Quais oportunidades estão paradas?",
  "Como estão o caixa, as despesas e o MRR?",
  "Quais campanhas geraram mais vendas?",
] as const;

const currency = (cents: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");

export function CopilotDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open || messages.length) return;
    let active = true;
    void fetch("/api/ai/copilot", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { result?: { pending: NonNullable<QueryResult["proposal"]>[] } };
      if (!active || !body.result?.pending.length) return;
      const restored: Message[] = body.result.pending.map((proposal) => ({ id: proposal.id, role: "COPILOT", text: proposal.resuming ? "Esta confirmação ficou pendente. Recupere o resultado com a mesma proposta; a venda não será duplicada." : "Você tem uma proposta aguardando revisão.", result: { answer: "", proposal, links: [] } }));
      setMessages((current) => current.length ? current : restored);
    }).catch(() => { /* Consultas enviadas pelo usuário apresentam falhas no próprio chat. */ });
    return () => { active = false; };
  }, [open, messages.length]);

  async function ask(value: string) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "USER", text: prompt }]);
    try {
      const response = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CHAT", message: prompt, history: messages.slice(-12).map((message) => ({ role: message.role === "USER" ? "user" : "assistant", content: message.text.slice(0, 6000) })) }),
      });
      const body = await response.json() as { result?: QueryResult; error?: { message?: string } };
      if (!response.ok || !body.result) {
        throw new Error(body.error?.message ?? "Não foi possível consultar o Copilot.");
      }
      const result = body.result;
      const text = result.answer;
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "COPILOT", text, result }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível consultar o Copilot.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(proposal: NonNullable<QueryResult["proposal"]>, action: "CONFIRM" | "CANCEL") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/copilot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, proposalId: proposal.id, expectedRevision: proposal.revision, ...(action === "CONFIRM" ? { confirmed: true } : {}) }),
      });
      const body = await response.json() as { result?: QueryResult; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível concluir a proposta.");
      setResolvedProposals((current) => [...current, proposal.id]);
      const result = body.result;
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "COPILOT", text: result.answer, result }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao confirmar a proposta.");
    } finally { setBusy(false); }
  }

  return (
    <aside aria-hidden={!open} aria-label="Chat do Copilot" className={styles.drawer} data-open={open} id="copilot-drawer" inert={!open}>
      <header className={styles.header}>
        <span className={styles.copilotIcon}><Icon name="copilot" size={18} /></span>
        <div><strong>Copilot</strong><small>Dados autorizados do CRM</small></div>
        <button aria-label="Fechar Copilot" className={styles.close} onClick={onClose} type="button">×</button>
      </header>

      <div aria-live="polite" className={styles.conversation}>
        {messages.length === 0 ? (
          <div className={styles.welcome}>
            <span><Icon name="copilot" size={24} /></span>
            <strong>Como posso ajudar?</strong>
            <p>Consulte vendas, financeiro, marketing e pós-venda. Para alterar uma venda, revise a prévia e confirme aqui.</p>
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(suggestion)} type="button">{suggestion}</button>)}
            </div>
          </div>
        ) : messages.map((message) => (
          <article className={styles.message} data-role={message.role} key={message.id}>
            <div>{message.text}</div>
            {message.result?.proposal ? (() => {
              const proposal = message.result.proposal;
              const preview = proposal.preview;
              const resolved = resolvedProposals.includes(proposal.id);
              return <section aria-label="Prévia de fechamento" className={styles.proposal}>
                <strong>Revise antes de confirmar</strong>
                <p>{preview.summary}</p>
                <dl>
                  <div><dt>Cliente</dt><dd>{preview.customerName}</dd></div>
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
                <p>Recebimento e pagamento de comissão dependem de comprovação. {proposal.resuming ? "Recuperação de confirmação anterior." : "Prévia válida por 30 minutos."}</p>
                {resolved ? <small>Proposta finalizada nesta conversa.</small> : <div className={styles.proposalActions}>
                  <button disabled={busy} onClick={() => void decide(proposal, "CONFIRM")} type="button">{proposal.resuming ? "Recuperar resultado" : "OK, confirmar fechamento"}</button>
                  {!proposal.resuming ? <button disabled={busy} onClick={() => void decide(proposal, "CANCEL")} type="button">Cancelar</button> : null}
                </div>}
              </section>;
            })() : null}
            {message.result?.links.length ? (
              <div className={styles.links}>
                {message.result.links.slice(0, 5).map((link) => <Link href={link.href} key={`${link.entityType}:${link.href}`} onClick={onClose}>{link.label}<span>↗</span></Link>)}
              </div>
            ) : null}
          </article>
        ))}
        {busy ? <div className={styles.typing} role="status"><span /><span /><span /><small>Copilot analisando</small></div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div ref={endRef} />
      </div>

      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
        <textarea aria-label="Pergunte ao Copilot" maxLength={4_000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void ask(question);
          }
        }} placeholder="Pergunte ou solicite uma ação…" ref={inputRef} rows={2} value={question} />
        <button aria-label="Enviar pergunta" disabled={busy || question.trim().length === 0} type="submit"><Icon name="mais" size={16} /></button>
        <small>Enter para enviar · Shift + Enter para quebrar linha</small>
      </form>
    </aside>
  );
}
