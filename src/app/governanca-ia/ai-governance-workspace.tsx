"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Screen = Awaited<ReturnType<typeof import("@/modules/ai/application/ai-governance-service").getAIGovernanceService>> extends never ? never : {
  mode: "LOCAL_DETERMINISTIC";
  externalProviderEnabled: boolean;
  period: { from: string; to: string; timeZone: string };
  versions: Array<{ id: string; key: string; version: number; name: string; description: string; riskLevel: string; status: string; provider: string; model: string; prompt: string; owner: string; confidenceThresholdBps: number; limits: { timeoutMs: number; maxRetries: number; rateLimitPerMinute: number; maxInputTokens: number; maxOutputTokens: number; maxEstimatedCostCents: number }; latestEvaluation: { status: string; passed: number; failed: number; createdAt: string } | null; approvedBy: string | null; approvedAt: string | null; approvalReason: string | null }>;
  observability: { totalExecutions: number; successfulExecutions: number; failureExecutions: number; fallbackExecutions: number; successRateBps: number | null; averageDurationMs: number | null; decisions: Record<string, number>; alerts: string[] };
  evaluations: Array<{ id: string; useCase: string; version: number; status: string; total: number; passed: number; failed: number; dataset: string; createdAt: string }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

const statusLabel: Readonly<Record<string, string>> = Object.freeze({
  DRAFT: "Rascunho",
  EVALUATED: "Avaliada",
  APPROVED: "Aprovada",
  DISABLED: "Desabilitada",
  RUNNING: "Em execução",
  PASSED: "Aprovada",
  FAILED: "Falhou",
});

export function AIGovernanceWorkspace({ initialScreen, roleKey }: Readonly<{ initialScreen: Screen; roleKey: string }>) {
  const [screen, setScreen] = useState(initialScreen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const canManage = roleKey === "administrator";

  async function act(versionId: string, action: "EVALUATE" | "APPROVE" | "DISABLE") {
    if (action !== "EVALUATE" && !window.confirm(
      action === "APPROVE"
        ? "Aprovar esta versão para novas execuções de IA?"
        : "Desabilitar esta versão para novas execuções de IA?",
    )) return;
    setBusyId(versionId);
    setFeedback(null);
    try {
      const response = await fetch("/api/ai/governance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, data: { useCaseVersionId: versionId, action, reason: action === "APPROVE" ? "Versão aprovada após avaliação local revisada." : "Alteração administrativa confirmada na governança local." } }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Ação não concluída.");
      const refreshed = await fetch("/api/ai/governance", { cache: "no-store" });
      const refreshedPayload = await refreshed.json() as { result: Screen };
      setScreen(refreshedPayload.result);
      setFeedback({ tone: "success", message: "Governança atualizada e auditada." });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "Não foi possível concluir a ação." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface-panel p-5" aria-label="Estado dos provedores">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Execução local governada</h2><p className="text-sm text-muted-foreground">Mock determinístico ativo. Provedor externo desabilitado; nenhuma credencial ou egress configurado.</p></div>
          <span className="status-badge" data-tone="success">Local e seguro</span>
        </div>
      </section>

      {feedback ? <div aria-live="polite" className={feedback.tone === "success" ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" : "rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"} role="status">{feedback.message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Observabilidade de IA">
        {[
          ["Execuções (30 dias)", screen.observability.totalExecutions],
          ["Sucesso", screen.observability.successRateBps === null ? "Sem base" : `${(screen.observability.successRateBps / 100).toFixed(1)}%`],
          ["Fallback local", screen.observability.fallbackExecutions],
          ["Latência média", screen.observability.averageDurationMs === null ? "Sem base" : `${screen.observability.averageDurationMs} ms`],
        ].map(([label, value]) => <article className="surface-panel p-4" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></article>)}
      </section>

      <section className="surface-panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm" aria-label="Decisões humanas registradas">
        <span className="font-semibold">Decisões humanas</span>
        <span>Aceitas: <strong className="tabular-nums">{screen.observability.decisions.ACCEPTED ?? 0}</strong></span>
        <span>Editadas: <strong className="tabular-nums">{screen.observability.decisions.EDITED ?? 0}</strong></span>
        <span>Rejeitadas: <strong className="tabular-nums">{screen.observability.decisions.REJECTED ?? 0}</strong></span>
        <span>Falhas de execução: <strong className="tabular-nums">{screen.observability.failureExecutions}</strong></span>
      </section>

      {screen.observability.alerts.length > 0 ? <section className="surface-panel border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold text-amber-950">Requer atenção</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-900">{screen.observability.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></section> : null}

      <section className="surface-panel overflow-hidden">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold">Registro canônico de casos de uso</h2><p className="text-sm text-muted-foreground">Conteúdo publicado é imutável; mudanças exigem nova versão, avaliação e aprovação.</p></div>
        <div className="divide-y divide-border">
          {screen.versions.map((version) => (
            <article className="grid gap-4 p-5 lg:grid-cols-[1.5fr_1fr_auto]" key={version.id}>
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{version.name}</h3><span className="status-badge">v{version.version}</span><span className="status-badge">{statusLabel[version.status] ?? version.status}</span><span className="status-badge">Risco {version.riskLevel}</span></div><p className="mt-2 text-sm text-muted-foreground">{version.description}</p><p className="mt-2 text-xs text-muted-foreground">Responsável: {version.owner} · Prompt: {version.prompt}</p></div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-muted-foreground">Provedor</dt><dd>{version.provider}</dd></div><div><dt className="text-muted-foreground">Modelo lógico</dt><dd>{version.model}</dd></div><div><dt className="text-muted-foreground">Confiança mínima</dt><dd className="tabular-nums">{version.confidenceThresholdBps / 100}%</dd></div><div><dt className="text-muted-foreground">Avaliação</dt><dd>{version.latestEvaluation ? `${version.latestEvaluation.passed}/${version.latestEvaluation.passed + version.latestEvaluation.failed}` : "Pendente"}</dd></div></dl>
              <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                <Button disabled={busyId === version.id} onClick={() => void act(version.id, "EVALUATE")} size="sm" variant="secondary">Avaliar</Button>
                {canManage && version.status === "EVALUATED" ? <Button disabled={busyId === version.id} onClick={() => void act(version.id, "APPROVE")} size="sm">Aprovar</Button> : null}
                {canManage && version.status === "APPROVED" ? <Button disabled={busyId === version.id} onClick={() => void act(version.id, "DISABLE")} size="sm" variant="secondary">Desabilitar</Button> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="surface-panel overflow-hidden">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold">Avaliações recentes</h2><p className="text-sm text-muted-foreground">Fixtures locais versionadas; payloads não são exibidos.</p></div>
        {screen.evaluations.length === 0 ? <div className="p-5"><p className="text-sm text-muted-foreground">Nenhuma avaliação executada.</p></div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Caso de uso</th><th>Dataset</th><th>Status</th><th>Casos</th><th>Executada em</th></tr></thead><tbody>{screen.evaluations.map((evaluation) => <tr key={evaluation.id}><td>{evaluation.useCase} v{evaluation.version}</td><td>{evaluation.dataset}</td><td>{statusLabel[evaluation.status] ?? evaluation.status}</td><td className="tabular-nums">{evaluation.passed}/{evaluation.total}</td><td>{formatDate(evaluation.createdAt)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
