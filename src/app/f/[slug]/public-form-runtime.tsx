"use client";
/* eslint-disable @next/next/no-img-element -- branding uses a validated, workspace-configured HTTPS URL with no fixed Next.js remote host. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MarketingFormDefinition, MarketingFormQuestion } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { publicFormAnswerError } from "@/modules/marketing-forms/domain/public-form-validation";
import styles from "@/app/f/[slug]/public-form-runtime.module.css";

type Answer = string | number | boolean | string[];
type PublicForm = Readonly<{
  slug: string;
  versionPublicId: string;
  title: string;
  questions: readonly MarketingFormQuestion[];
  thankYou: MarketingFormDefinition["thankYou"];
  style: MarketingFormDefinition["style"];
}>;
type SubmitResult = Readonly<{
  receiptPublicId: string;
  outcome: string;
  redirect?: { kind: string; url: string } | null;
  providerEventIds?: Readonly<{ meta?: string }>;
}>;

function cssString(value: string) { return JSON.stringify(value).replaceAll("<", "\\3c ").replaceAll(">", "\\3e "); }

export function PublicFormRuntime({ form, nonce }: Readonly<{ form: PublicForm; nonce: string | null }>) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [sessionPublicId] = useState(() => typeof window === "undefined" ? "" : crypto.randomUUID());
  const [idempotencyToken] = useState(() => typeof window === "undefined" ? "" : crypto.randomUUID());
  const [honeypot, setHoneypot] = useState("");
  const startedAt = useRef(new Date().toISOString());
  const started = useRef(false);
  const answered = useRef(new Set<string>());
  const eventIds = useRef(new Map<string, string>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const question = form.questions[index];
  const progress = done ? 100 : Math.max(4, Math.round((index / form.questions.length) * 100));
  const radius = { NONE: "0", SM: "6px", MD: "10px", LG: "16px", PILL: "999px" }[form.style.radius];
  const fontFamily = form.style.font === "SERIF" ? "Georgia, serif" : form.style.font === "SYSTEM" ? "system-ui, sans-serif" : "Inter, system-ui, sans-serif";
  const answer = question ? answers[question.stableKey] : undefined;
  const dynamicCss = useMemo(() => {
    const selector = `[data-marketing-form="${form.versionPublicId}"]`;
    return `${selector}{--form-cta:${form.style.ctaColor};--form-question:${form.style.questionColor};--form-answer:${form.style.answerColor};--form-radius:${radius};background-color:${form.style.backgroundColor};${form.style.backgroundImageUrl ? `background-image:linear-gradient(rgb(255 255 255 / 88%),rgb(255 255 255 / 88%)),url(${cssString(form.style.backgroundImageUrl)});` : ""}font-family:${fontFamily};text-align:${form.style.alignment === "CENTER" ? "center" : "left"};}${selector} .${styles.progress} span{width:${progress}%;}`;
  }, [fontFamily, form.style, form.versionPublicId, progress, radius]);

  useEffect(() => { headingRef.current?.focus(); }, [index, done]);

  const tracking = useCallback(() => {
    const query = new URLSearchParams(window.location.search);
    const clickIds = Object.fromEntries(["gclid", "fbclid", "msclkid", "ttclid"].flatMap((key) => query.get(key) ? [[key, query.get(key)!]] : []));
    return {
      landingUrl: window.location.href,
      referrerUrl: document.referrer || undefined,
      utmSource: query.get("utm_source") || undefined,
      utmMedium: query.get("utm_medium") || undefined,
      utmCampaign: query.get("utm_campaign") || undefined,
      utmContent: query.get("utm_content") || undefined,
      utmTerm: query.get("utm_term") || undefined,
      clickIds: Object.keys(clickIds).length ? clickIds : undefined,
    };
  }, []);

  const sendEvents = useCallback(async (events: ReadonlyArray<{ kind: "FORM_VIEW" | "FORM_START" | "QUESTION_VIEWED" | "QUESTION_ANSWERED" | "REDIRECT_OPENED"; questionKey?: string; optionKey?: string }>) => {
    if (!sessionPublicId) return;
    try {
      await fetch(`/api/public/forms/${form.slug}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ versionPublicId: form.versionPublicId, sessionPublicId, tracking: tracking(), events: events.map((event) => { const key = `${event.kind}:${event.questionKey ?? ""}:${event.optionKey ?? ""}`; const eventId = eventIds.current.get(key) ?? crypto.randomUUID(); eventIds.current.set(key, eventId); return { ...event, eventId, occurredAt: new Date().toISOString() }; }) }),
      });
    } catch { /* Telemetria nunca bloqueia a experiência pública. */ }
  }, [form.slug, form.versionPublicId, sessionPublicId, tracking]);

  useEffect(() => {
    if (!sessionPublicId || done || !question) return;
    void sendEvents([{ kind: "QUESTION_VIEWED", questionKey: question.stableKey }]);
  }, [done, index, question, sendEvents, sessionPublicId]);
  useEffect(() => {
    if (!sessionPublicId) return;
    void sendEvents([{ kind: "FORM_VIEW" }]);
  }, [sendEvents, sessionPublicId]);

  function setAnswer(value: Answer) { if (!question) return; setAnswers((current) => ({ ...current, [question.stableKey]: value })); setError(null); }
  async function advance() {
    if (!question) return;
    const validation = publicFormAnswerError(question, answer); if (validation) { setError(validation); return; }
    const telemetry: Array<{ kind: "FORM_START" | "QUESTION_ANSWERED"; questionKey?: string; optionKey?: string }> = [];
    if (!started.current) { started.current = true; telemetry.push({ kind: "FORM_START" }); }
    if (!answered.current.has(question.stableKey)) {
      answered.current.add(question.stableKey);
      const optionKey = typeof answer === "string" && ["SINGLE_CHOICE", "DROPDOWN"].includes(question.type) ? answer : undefined;
      telemetry.push({ kind: "QUESTION_ANSWERED", questionKey: question.stableKey, ...(optionKey ? { optionKey } : {}) });
    }
    void sendEvents(telemetry);
    if (index < form.questions.length - 1) { setIndex((current) => current + 1); setError(null); return; }
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/public/forms/${form.slug}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionPublicId: form.versionPublicId, sessionPublicId, idempotencyToken, answers: form.questions.flatMap((item) => answers[item.stableKey] === undefined ? [] : [{ questionKey: item.stableKey, value: answers[item.stableKey] }]), honeypot, startedAt: startedAt.current, tracking: tracking() }) });
      const body = await response.json() as { result?: SubmitResult; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível enviar agora. Tente novamente.");
      setDone(body.result);
      const metaEventId = body.result.providerEventIds?.meta;
      const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
      if (metaEventId && typeof fbq === "function") {
        try { fbq("track", "Lead", {}, { eventID: metaEventId }); } catch { /* O pixel opcional nunca bloqueia o lead. */ }
      }
      if (body.result.redirect?.url) window.setTimeout(() => { void sendEvents([{ kind: "REDIRECT_OPENED" }]); window.location.assign(body.result!.redirect!.url); }, 900);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível enviar agora. Tente novamente."); }
    finally { setSubmitting(false); }
  }
  function onKeyDown(event: React.KeyboardEvent) { if (event.key !== "Enter") return; if (event.target instanceof HTMLTextAreaElement && !(event.ctrlKey || event.metaKey)) return; event.preventDefault(); void advance(); }

  return <main className={styles.shell} data-marketing-form={form.versionPublicId} onKeyDown={onKeyDown}>
    <style nonce={nonce ?? undefined}>{dynamicCss}</style>
    <div aria-hidden="true" className={styles.progress}><span /></div>
    {form.style.logoUrl ? <img alt={form.title} className={styles.logo} height={72} src={form.style.logoUrl} width={240} /> : null}
    {!done && question ? <section className={styles.question} key={question.stableKey}><p className={styles.counter}>{index + 1} → {form.questions.length}</p><h1 id="question-title" ref={headingRef} tabIndex={-1}>{question.title}{question.required ? <span aria-label="obrigatória"> *</span> : null}</h1>{question.description ? <p className={styles.description} id="question-description">{question.description}</p> : null}<QuestionInput answer={answer} error={error} question={question} setAnswer={setAnswer} /><div className={styles.actions}><button className={styles.primary} disabled={submitting} onClick={() => void advance()} type="button">{submitting ? "Enviando…" : index === form.questions.length - 1 ? "Enviar" : "Avançar"} <span aria-hidden="true">↵</span></button><small>pressione Enter</small></div>{error ? <p aria-live="polite" className={styles.error} id="question-error" role="alert">{error}</p> : null}</section> : null}
    {done ? <section className={styles.thankYou}><p aria-hidden="true">✓</p><h1 ref={headingRef} tabIndex={-1}>{form.thankYou.title}</h1><div>{form.thankYou.message}</div>{done.redirect ? <a className={styles.primary} href={done.redirect.url}>{form.thankYou.ctaLabel ?? "Continuar"}</a> : null}</section> : null}
    {!done ? <nav aria-label="Navegação entre perguntas" className={styles.arrows}><button aria-label="Pergunta anterior" disabled={index === 0 || submitting} onClick={() => { setIndex((current) => Math.max(0, current - 1)); setError(null); }} type="button">↑</button><button aria-label="Próxima pergunta" disabled={index === form.questions.length - 1 || submitting} onClick={() => void advance()} type="button">↓</button></nav> : null}
    <input aria-hidden="true" autoComplete="off" className={styles.honeypot} name="website" onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} value={honeypot} />
  </main>;
}

function QuestionInput({ question, answer, error, setAnswer }: Readonly<{ question: MarketingFormQuestion; answer: Answer | undefined; error: string | null; setAnswer: (value: Answer) => void }>) {
  const describedBy = [question.description ? "question-description" : null, error ? "question-error" : null].filter(Boolean).join(" ") || undefined;
  const accessibility = { "aria-describedby": describedBy, "aria-invalid": Boolean(error), "aria-labelledby": "question-title" } as const;
  if (question.type === "LONG_TEXT") return <textarea {...accessibility} autoFocus maxLength={question.config.maxLength} onChange={(event) => setAnswer(event.target.value)} placeholder={question.config.placeholder ?? "Digite sua resposta…"} rows={3} value={typeof answer === "string" ? answer : ""} />;
  if (["SHORT_TEXT", "EMAIL", "PHONE", "NUMBER", "DATE"].includes(question.type)) { const type = question.type === "EMAIL" ? "email" : question.type === "PHONE" ? "tel" : question.type === "NUMBER" ? "number" : question.type === "DATE" ? "date" : "text"; const bounds = question.type === "NUMBER" || question.type === "DATE" ? { min: question.config.min, max: question.config.max } : {}; const step = question.type === "NUMBER" ? question.config.step : undefined; return <input {...accessibility} {...bounds} autoFocus onChange={(event) => setAnswer(type === "number" ? event.target.valueAsNumber : event.target.value)} placeholder={("placeholder" in question.config ? question.config.placeholder : undefined) ?? "Digite sua resposta…"} step={step} type={type} value={typeof answer === "string" || typeof answer === "number" ? answer : ""} />; }
  if (question.type === "CHECKBOX") return <label className={styles.checkbox}><input {...accessibility} checked={answer === true} onChange={(event) => setAnswer(event.target.checked)} type="checkbox" /><span>{question.config.label}</span></label>;
  if (question.type === "DROPDOWN") return <select {...accessibility} autoFocus onChange={(event) => setAnswer(event.target.value)} value={typeof answer === "string" ? answer : ""}><option value="">{question.config.placeholder ?? "Selecione"}</option>{question.config.options.map((option) => <option key={option.stableKey} value={option.stableKey}>{option.label}</option>)}</select>;
  if (question.type !== "SINGLE_CHOICE" && question.type !== "MULTIPLE_CHOICE") return null;
  const multiple = question.type === "MULTIPLE_CHOICE"; const selected = Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : [];
  return <div {...accessibility} className={styles.choices} role="group">{question.config.options.map((option, index) => { const checked = selected.includes(option.stableKey); return <label key={option.stableKey}><input checked={checked} name={multiple ? undefined : question.stableKey} onChange={(event) => setAnswer(multiple ? event.target.checked ? [...selected, option.stableKey] : selected.filter((key) => key !== option.stableKey) : option.stableKey)} type={multiple ? "checkbox" : "radio"} /><b>{String.fromCharCode(65 + index)}</b><span>{option.label}</span></label>; })}</div>;
}
