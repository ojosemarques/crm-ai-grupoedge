"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { LeadScoreView } from "@/modules/qualification/domain/scoring-contracts";

const factorLabels: Readonly<Record<string, string>> = {
  PAIN: "Dor explícita",
  CAPACITY: "Capacidade",
  DECISION: "Decisão",
  INTENT: "Intenção em até 30 dias",
  CONTEXT: "Contexto compatível",
  NO_CAPACITY: "Sem capacidade",
  NO_PAIN: "Sem dor",
  CURIOSITY: "Curiosidade",
  INVALID_CONTACT: "Contato inválido",
  NO_DECISION_ACCESS: "Sem acesso ao decisor",
  HUMAN_OVERRIDE: "Override humano",
  AI_SUGGESTION: "Sugestão de IA",
};

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

async function resultFrom(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível atualizar a pontuação.");
  return body.result;
}

export function ScoringWorkspace({
  initialScore,
  onUpdated,
  onCommitted,
}: Readonly<{
  initialScore: LeadScoreView;
  onUpdated: (score: LeadScoreView) => void;
  onCommitted: () => Promise<void>;
}>) {
  const score = initialScore;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);

  async function refresh() {
    const response = await fetch(`/api/leads/${score.leadId}/score`, { cache: "no-store" });
    const result = (await resultFrom(response)) as LeadScoreView;
    onUpdated(result);
  }

  async function mutate(action: "OVERRIDE" | "RECALCULATE", data: Record<string, unknown>) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${score.leadId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: { ...data, expectedRevision: score.revision } }),
      });
      await resultFrom(response);
      await refresh();
      await onCommitted();
      setNotice({ kind: "success", message: action === "OVERRIDE" ? "Prioridade alterada com motivo e auditoria." : "Pontuação recalculada sem apagar o histórico." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("OVERRIDE", {
      score: Number(form.get("score")),
      reason: String(form.get("reason") ?? "").trim(),
    });
  }

  return (
    <section className="surface-panel space-y-5 p-5" aria-labelledby="score-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" id="score-title">Pontuação e prioridade explicáveis</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A pontuação vigente é uma projeção explícita. Formulário, validação humana e sugestão de IA permanecem separados no histórico.
          </p>
        </div>
        {score.current ? (
          <div className="rounded-md border px-4 py-2 text-right">
            <p className="text-xs text-muted-foreground">{score.current.sourceLabel}</p>
            <p className="text-2xl font-bold">{score.current.score} · {score.current.priorityBandCode}</p>
            <p className="text-xs">Regra v{score.current.rule?.version ?? "legada"}</p>
          </div>
        ) : null}
      </div>

      {!score.current ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma pontuação vigente foi calculada.</p>
      ) : (
        <>
          <p className="text-sm leading-6">{score.current.reason}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {score.current.components.map((component) => (
              <li className="rounded-md border p-3 text-sm" key={component.factor}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{factorLabels[component.factor] ?? component.factor}</span>
                  <span className="font-mono font-semibold">{component.points > 0 ? "+" : ""}{component.points}/{component.maxPoints}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{component.reason}{component.missingData ? " · dado ausente" : ""}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Calculada por {score.current.calculatedBy} em {formatDate(score.current.calculatedAt, score.timeZone)}.
          </p>
        </>
      )}

      {notice ? (
        <div className={`rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </div>
      ) : null}

      {score.canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-4">
            <h3 className="font-semibold">Recalcular</h3>
            <p className="mt-1 text-xs text-muted-foreground">Usa o último PACTO validado; na ausência dele, usa o último formulário. Cria nova revisão.</p>
            <Button className="mt-3" disabled={pending} onClick={() => void mutate("RECALCULATE", {})} type="button" variant="secondary">Recalcular com a regra vigente</Button>
          </div>
          <form className="rounded-md border p-4" onSubmit={submitOverride}>
            <h3 className="font-semibold">Override humano</h3>
            <div className="mt-3 grid gap-3">
              <label className="text-sm">Pontuação (0 a 100)<input className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" max="100" min="0" name="score" required type="number" /></label>
              <label className="text-sm">Motivo obrigatório<textarea className="mt-1.5 min-h-20 w-full rounded-md border bg-background px-3 py-2" minLength={3} name="reason" required /></label>
              <Button disabled={pending} type="submit">Aplicar override</Button>
            </div>
          </form>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Seu perfil possui acesso somente para leitura desta pontuação.</p>
      )}

      <div>
        <h3 className="font-semibold">Histórico de pontuação</h3>
        {score.history.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma revisão registrada.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {score.history.map((item) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" key={item.id}>
                <span><strong>{item.score} · {item.priorityBandCode}</strong> — {item.sourceLabel}{item.currentRevision ? ` · revisão vigente ${item.currentRevision}` : " · sinal não vigente"}</span>
                <span className="text-xs text-muted-foreground">{item.calculatedBy} · {formatDate(item.calculatedAt, score.timeZone)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
