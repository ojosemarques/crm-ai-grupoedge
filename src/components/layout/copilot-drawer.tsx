"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import styles from "./copilot-drawer.module.css";

type QueryResult = Readonly<{
  classification: Readonly<{
    data: readonly string[];
    inference: readonly string[];
    absence: readonly string[];
  }>;
  answer: Readonly<{
    directAnswer: string;
    numbers: readonly Readonly<{ label: string; value: number | null; unit?: string }>[];
  }> | null;
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
  "Onde o funil mais perde conversão?",
] as const;

function formatMetric(value: number | null, unit?: string) {
  if (value === null) return "Sem dado";
  if (unit === "PERCENTAGE" || unit === "BASIS_POINTS") {
    return `${(unit === "BASIS_POINTS" ? value / 100 : value).toLocaleString("pt-BR")}%`;
  }
  if (unit === "CURRENCY_CENTS") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
  }
  return value.toLocaleString("pt-BR");
}

export function CopilotDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
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

  async function ask(value: string) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "USER", text: prompt }]);
    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "QUERY", payload: { question: prompt, preset: "MONTH" } }),
      });
      const body = await response.json() as { result?: QueryResult; error?: { message?: string } };
      if (!response.ok || !body.result) {
        throw new Error(body.error?.message ?? "Não foi possível consultar o Copilot.");
      }
      const result = body.result;
      const text = result.answer?.directAnswer
        ?? result.classification.absence[0]
        ?? "Não encontrei uma resposta homologada para essa pergunta.";
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "COPILOT", text, result }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível consultar o Copilot.");
    } finally {
      setBusy(false);
    }
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
            <p>Consulte os dados comerciais e descubra onde sua equipe precisa agir.</p>
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(suggestion)} type="button">{suggestion}</button>)}
            </div>
          </div>
        ) : messages.map((message) => (
          <article className={styles.message} data-role={message.role} key={message.id}>
            <div>{message.text}</div>
            {message.result?.answer?.numbers.length ? (
              <dl className={styles.metrics}>
                {message.result.answer.numbers.slice(0, 4).map((metric) => (
                  <div key={metric.label}><dt>{metric.label}</dt><dd>{formatMetric(metric.value, metric.unit)}</dd></div>
                ))}
              </dl>
            ) : null}
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
        <textarea aria-label="Pergunte ao Copilot" maxLength={2_000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void ask(question);
          }
        }} placeholder="Pergunte sobre vendas, leads ou funil…" ref={inputRef} rows={2} value={question} />
        <button aria-label="Enviar pergunta" disabled={busy || question.trim().length === 0} type="submit"><Icon name="mais" size={16} /></button>
        <small>Enter para enviar · Shift + Enter para quebrar linha</small>
      </form>
    </aside>
  );
}
