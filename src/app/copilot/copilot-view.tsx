"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "./copilot.module.css";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader, Surface } from "@/components/ui/surface";
import type {
  ManagerCopilotConfirmation,
  ManagerCopilotResult,
} from "@/modules/ai/domain/manager-copilot-contracts";
import type {
  ManagerAnalyticsNumber,
  ManagerAnalyticsShell,
  ManagerQuestionId,
} from "@/modules/metrics/domain/manager-analytics-contracts";

type ApiError = Readonly<{ error?: Readonly<{ message?: string }> }>;

const periodNames = {
  TODAY: "Hoje", YESTERDAY: "Ontem", WEEK: "Semana atual", MONTH: "Mês atual",
} as const;

const modeNames = {
  LOCAL_DETERMINISTIC: "Local determinístico",
  EXTERNAL: "Provedor externo",
  FALLBACK_LOCAL: "Fallback local",
} as const;

function formatNumber(metric: ManagerAnalyticsNumber) {
  if (metric.value === null) return "Sem amostra";
  if (metric.unit === "PERCENTAGE") return `${metric.value.toLocaleString("pt-BR")}%`;
  if (metric.unit === "DAYS") return `${metric.value.toLocaleString("pt-BR")} dias`;
  return metric.value.toLocaleString("pt-BR");
}

function SelectFilter({
  name, label, options, selected,
}: Readonly<{
  name: string;
  label: string;
  options: readonly Readonly<{ id: string; name: string }>[];
  selected: readonly string[];
}>) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <select
        className="min-h-10 rounded-md border bg-background px-2 py-2 text-sm font-normal text-foreground"
        defaultValue={selected}
        multiple
        name={name}
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

async function responseJson<T extends object>(response: Response): Promise<T> {
  const payload = await response.json() as T | ApiError;
  if (!response.ok) {
    throw new Error("error" in payload && payload.error?.message
      ? payload.error.message
      : "Não foi possível concluir a solicitação.");
  }
  return payload as T;
}

export function CopilotView({ shell }: Readonly<{ shell: ManagerAnalyticsShell }>) {
  const [result, setResult] = useState<ManagerCopilotResult | null>(null);
  const [activeRecordGroupId, setActiveRecordGroupId] = useState<string | null>(null);
  const [runningQuestionId, setRunningQuestionId] = useState<ManagerQuestionId | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function runQuestion(questionId: ManagerQuestionId) {
    setRunningQuestionId(questionId);
    setError(null);
    setNotice(null);
    setResult(null);
    setActiveRecordGroupId(null);
    try {
      const payload = await responseJson<{ result: ManagerCopilotResult }>(await fetch("/api/ai/manager-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RUN", data: { questionId, query: shell.query } }),
      }));
      setResult(payload.result);
      setActiveRecordGroupId(payload.result.answer.numerator.recordGroupId);
      setReviewNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada ao consultar o Copilot.");
    } finally {
      setRunningQuestionId(null);
    }
  }

  async function review(decision: "CONFIRM" | "REJECT") {
    if (!result) return;
    if (reviewNote.trim().length < 3) {
      setError("Informe uma observação com pelo menos 3 caracteres para registrar a decisão.");
      return;
    }
    setReviewing(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await responseJson<{ result: ManagerCopilotConfirmation }>(await fetch("/api/ai/manager-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CONFIRM",
          data: { insightId: result.trace.insightId, decision, note: reviewNote },
        }),
      }));
      setResult({ ...result, trace: { ...result.trace, status: payload.result.status } });
      setNotice(payload.result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada ao registrar a decisão.");
    } finally {
      setReviewing(false);
    }
  }

  const answer = result?.answer;
  const activeGroup = answer?.recordGroups.find((group) => group.id === activeRecordGroupId)
    ?? answer?.recordGroups.find((group) => group.id === answer.numerator.recordGroupId)
    ?? null;
  const activeKeys = new Set(activeGroup?.recordKeys ?? []);
  const activeRecords = answer?.relatedRecords.filter((record) => activeKeys.has(record.key)) ?? [];
  const activeFilterCount = Object.values(shell.query.filters).reduce((total, values) => total + values.length, 0);

  return (
    <div className={styles.workspace}>
      <header className={styles.intro}><span><Icon name="copilot" size={25} /></span><div><h2>O que vamos analisar hoje?</h2><p>Explore os resultados e encontre o próximo passo para sua equipe.</p></div></header>
      <details className={styles.filters} open={activeFilterCount > 0}><summary><Icon name="filtro" size={14} />Período e filtros<span>{shell.query.fromDate} → {shell.query.toDate} · {activeFilterCount} filtros</span></summary>
      <Surface className="p-5" aria-labelledby="copilot-filters" tone="subtle">
        <SectionHeader action={<StatusBadge tone={activeFilterCount > 0 ? "info" : "neutral"}>{activeFilterCount} filtros dimensionais</StatusBadge>} description={`Intervalo civil em ${shell.timeZone}; início incluso e fim exclusivo.`} eyebrow="Universo da análise" title="Período e filtros" titleId="copilot-filters" />
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Atalhos de período">
          {(["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map((preset) => (
            <Link
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${shell.query.preset === preset ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}
              href={`/copilot?preset=${preset}`}
              key={preset}
            >
              {periodNames[preset]}
            </Link>
          ))}
        </nav>
        <form className="mt-5 grid gap-4 lg:grid-cols-4" method="get">
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">Período
            <select className="h-10 rounded-md border bg-background px-2 text-sm font-normal text-foreground" defaultValue={shell.query.preset} name="preset">
              <option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana atual</option><option value="MONTH">Mês atual</option><option value="CUSTOM">Personalizado</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">Data inicial
            <input className="h-10 rounded-md border bg-background px-2 text-sm font-normal text-foreground" defaultValue={shell.query.fromDate} name="fromDate" type="date" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">Data final
            <input className="h-10 rounded-md border bg-background px-2 text-sm font-normal text-foreground" defaultValue={shell.query.toDate} name="toDate" type="date" />
          </label>
          <div className="flex items-end gap-2"><button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground" type="submit">Aplicar</button><Link className="flex h-10 items-center rounded-md border px-4 text-sm font-semibold" href="/copilot?preset=MONTH">Limpar</Link></div>
          <details className="rounded-[var(--radius-control)] border bg-card p-3 lg:col-span-4" open={activeFilterCount > 0}>
            <summary className="cursor-pointer font-semibold text-primary">Filtros dimensionais · {activeFilterCount} ativos</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <SelectFilter name="sdr" label="SDR" options={shell.filterOptions.sdrs} selected={shell.query.filters.sdrMemberIds} />
              <SelectFilter name="closer" label="Closer" options={shell.filterOptions.closers} selected={shell.query.filters.closerMemberIds} />
              <SelectFilter name="team" label="Equipe" options={shell.filterOptions.teams} selected={shell.query.filters.teamIds} />
              <SelectFilter name="source" label="Origem" options={shell.filterOptions.sources} selected={shell.query.filters.sourceIds} />
              <SelectFilter name="campaign" label="Campanha" options={shell.filterOptions.campaigns} selected={shell.query.filters.campaignIds} />
              <SelectFilter name="creative" label="Criativo" options={shell.filterOptions.creatives} selected={shell.query.filters.creativeIds} />
              <SelectFilter name="priority" label="Prioridade" options={shell.filterOptions.priorities} selected={shell.query.filters.priorityCodes} />
              <SelectFilter name="product" label="Produto" options={shell.filterOptions.products} selected={shell.query.filters.productIds} />
            </div>
          </details>
        </form>
      </Surface></details>

      <section aria-labelledby="manager-questions" className={styles.questions}>
        <SectionHeader description="Selecione uma pergunta para analisar os dados do período." eyebrow="Seu copiloto de negócios" title="Comece por uma pergunta" titleId="manager-questions" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {shell.questions.map((question) => (
            <button
              className="min-h-24 rounded-[0.875rem] border bg-card p-4 text-left text-sm font-semibold shadow-sm transition-colors hover:border-[var(--brand-steel)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
              disabled={runningQuestionId !== null}
              key={question.id}
              onClick={() => void runQuestion(question.id)}
              type="button"
            >
              {runningQuestionId === question.id ? "Analisando…" : question.label}
            </button>
          ))}
        </div>
      </section>

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950" role="alert">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-950" role="status">{notice}</div> : null}

      {answer && result ? (
        <Surface className="space-y-5 p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resposta direta</p><h2 className="mt-1 text-2xl font-bold">{answer.question}</h2></div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">{modeNames[result.trace.mode]}</span><span className="rounded-full bg-muted px-3 py-1">Confiança {answer.confidence.label} · {(answer.confidence.value * 100).toLocaleString("pt-BR")}%</span></div>
          </div>
          <p className="rounded-md border-l-4 border-primary bg-muted/50 p-4 text-base leading-7">{answer.directAnswer}</p>

          <dl className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3"><dt className="font-semibold">Período</dt><dd className="mt-1 text-muted-foreground">{answer.period.fromDate} a {answer.period.toDate} · {answer.period.timeZone}</dd></div>
            <div className="rounded-md border p-3"><dt className="font-semibold">Filtros aplicados</dt><dd className="mt-1 text-muted-foreground">{answer.filters.join(" · ")}</dd></div>
            <div className="rounded-md border p-3"><dt className="font-semibold">Escopo autorizado</dt><dd className="mt-1 text-muted-foreground">{answer.scope === "WORKSPACE" ? "Workspace" : "Equipe"}</dd></div>
            <div className="rounded-md border p-3"><dt className="font-semibold">Rastreabilidade</dt><dd className="mt-1 text-muted-foreground">{result.trace.promptKey} v{result.trace.promptVersion} · {result.trace.providerKey}</dd></div>
          </dl>
          <div className="rounded-md border p-4 text-sm">
            <p><strong>Fórmula:</strong> {answer.formula}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-md border px-3 py-2 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActiveRecordGroupId(answer.numerator.recordGroupId)} type="button"><strong>Numerador:</strong> {answer.numerator.value.toLocaleString("pt-BR")} · abrir registros</button>
              {answer.denominator ? <button className="rounded-md border px-3 py-2 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActiveRecordGroupId(answer.denominator!.recordGroupId)} type="button"><strong>Denominador:</strong> {answer.denominator.value.toLocaleString("pt-BR")} · abrir registros</button> : <span className="rounded-md border px-3 py-2 text-muted-foreground">Sem denominador</span>}
            </div>
          </div>
          <div><h3 className="font-bold">Números e registros</h3><p className="mt-1 text-xs text-muted-foreground">Selecione qualquer número para abrir exatamente seu conjunto de registros.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{answer.numbers.map((metric) => <button className={`rounded-md border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeRecordGroupId === metric.recordGroupId ? "border-primary bg-blue-50" : "hover:border-primary"}`} key={`${metric.label}-${metric.recordGroupId}`} onClick={() => setActiveRecordGroupId(metric.recordGroupId)} type="button"><span className="text-xs font-semibold text-muted-foreground">{metric.label}</span><strong className="mt-1 block text-xl">{formatNumber(metric)}</strong><span className="mt-2 block text-xs text-primary">Abrir registros →</span></button>)}</div></div>

          {answer.comparison ? <div className="rounded-md border p-4 text-sm"><h3 className="font-bold">Comparação</h3><p className="mt-1 text-muted-foreground">{answer.comparison.label}. Atual: {answer.comparison.current === null ? "sem amostra" : `${answer.comparison.current.toLocaleString("pt-BR")}${answer.comparison.unit === "PERCENTAGE" ? "%" : ""}`}; anterior: {answer.comparison.previous === null ? "sem amostra" : `${answer.comparison.previous.toLocaleString("pt-BR")}${answer.comparison.unit === "PERCENTAGE" ? "%" : ""}`}; variação: {answer.comparison.delta === null ? "indisponível" : `${answer.comparison.delta.toLocaleString("pt-BR")}${answer.comparison.unit === "PERCENTAGE" ? " p.p." : ""}`}.</p></div> : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div><h3 className="font-bold">Evidências</h3>{answer.evidence.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{answer.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhuma evidência adicional neste recorte.</p>}</div>
            <div><h3 className="font-bold">Possíveis causas</h3><p className="mt-1 text-xs text-muted-foreground">Hipóteses correlacionais; não são afirmações de causalidade.</p>{answer.possibleCauses.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{answer.possibleCauses.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Dados insuficientes para levantar causas possíveis.</p>}</div>
          </div>

          <section className="rounded-md border p-4" id="copilot-records"><h3 className="font-bold">Registros relacionados · {activeGroup?.label ?? "Numerador"}</h3>{activeRecords.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhum registro compõe este número no recorte atual.</p> : <ul className="mt-3 divide-y rounded-md border">{activeRecords.map((record) => <li className="flex flex-wrap items-center justify-between gap-3 p-3" key={record.key}><div><p className="text-sm font-semibold">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.subtitle} · {record.responsibleName ?? "Sem responsável nominal"}</p></div><Link className="text-sm font-semibold text-primary underline" href={record.href}>Abrir registro</Link></li>)}</ul>}</section>

          <div className="grid gap-5 lg:grid-cols-2">
            <div><h3 className="font-bold">Limitações</h3>{answer.limitations.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{answer.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhuma limitação adicional identificada.</p>}<p className="mt-3 text-xs text-muted-foreground">Confiança: {answer.confidence.reason}</p></div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950"><h3 className="font-bold">Ação recomendada</h3><p className="mt-2 text-sm font-semibold">{answer.recommendedAction.title}</p><p className="mt-1 text-sm">{answer.recommendedAction.reason}</p>{result.trace.status === "OPEN" ? <div className="mt-4"><label className="grid gap-1 text-xs font-semibold">Observação obrigatória<textarea className="min-h-20 rounded-md border border-amber-400 bg-white p-2 text-sm font-normal text-foreground" onChange={(event) => setReviewNote(event.target.value)} value={reviewNote} /></label><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={reviewing} onClick={() => void review("CONFIRM")} type="button">Confirmar plano</button><button className="rounded-md border border-amber-500 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60" disabled={reviewing} onClick={() => void review("REJECT")} type="button">Rejeitar</button></div><p className="mt-2 text-xs">A confirmação registra a decisão; não redistribui nem altera registros.</p></div> : <p className="mt-4 rounded-md bg-white p-3 text-sm font-semibold">Decisão registrada: {result.trace.status === "ACCEPTED" ? "plano confirmado" : "recomendação rejeitada"}.</p>}</div>
          </div>
        </Surface>
      ) : runningQuestionId === null && !error ? <EmptyState description="A análise só começa após uma seleção explícita e usará os filtros acima." title="Escolha uma pergunta gerencial" /> : null}
    </div>
  );
}
