"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  LeadIntelligenceInsight,
  LeadIntelligenceProposal,
  LeadIntelligenceScreen,
  LeadIntelligenceUseCase,
} from "@/modules/ai/domain/lead-intelligence-contracts";

type Notice = Readonly<{ kind: "success" | "error"; message: string }> | null;

const inputClass =
  "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const textareaClass =
  "mt-1.5 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

const useCaseLabels: Readonly<Record<LeadIntelligenceUseCase, string>> = {
  LEAD_ANALYSIS: "Análise do lead",
  CALL_PREPARATION: "Preparação da ligação",
  CONVERSATION_EXTRACTION: "Extração de conversa",
  NEXT_BEST_ACTION: "Próxima melhor ação",
};

const statusLabels: Readonly<Record<string, string>> = {
  OPEN: "Aguardando decisão humana",
  ACCEPTED: "Em aplicação",
  EXECUTED: "Aplicada após confirmação",
  REJECTED: "Rejeitada",
  EXPIRED: "Expirada",
};

const urgencyLabels: Readonly<Record<string, string>> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  IMMEDIATE: "Imediata",
};

const pactoStatusLabels: Readonly<Record<string, string>> = {
  UNKNOWN: "Não investigado",
  POSITIVE: "Favorável",
  PARTIAL: "Parcial",
  NEGATIVE: "Desfavorável",
  DISQUALIFYING: "Desqualificante",
  NOT_INVESTIGATED: "Não investigado",
  FAVORABLE: "Favorável",
  UNFAVORABLE: "Desfavorável",
};

async function responseResult(response: Response): Promise<LeadIntelligenceScreen> {
  const body = (await response.json().catch(() => ({}))) as {
    result?: LeadIntelligenceScreen;
    error?: { message?: string };
  };
  if (!response.ok || !body.result) {
    const error = new Error(body.error?.message ?? "Não foi possível concluir a operação.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body.result;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function factValues(insight: LeadIntelligenceInsight, field: string) {
  const prefix = `${field}: `;
  return insight.output.facts
    .map((fact) => fact.statement)
    .filter((statement) => statement.startsWith(prefix))
    .map((statement) => statement.slice(prefix.length));
}

function EvidenceAndUncertainty({ insight }: Readonly<{ insight: LeadIntelligenceInsight }>) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-md border p-4">
        <h4 className="font-semibold">Fatos</h4>
        {insight.output.facts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum fato disponível.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {insight.output.facts.map((fact, index) => (
              <li key={`${fact.statement}-${index}`}>
                {fact.statement}
                <span className="ml-1 text-xs text-muted-foreground">({fact.source})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border p-4">
        <h4 className="font-semibold">Inferências</h4>
        {insight.output.inferences.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhuma inferência foi produzida no modo local.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {insight.output.inferences.map((item, index) => (
              <li key={`${item.statement}-${index}`}>
                {item.statement} · confiança {Math.round(item.confidence * 100)}%
                <span className="block text-xs text-muted-foreground">Base: {item.basis}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border p-4">
        <h4 className="font-semibold">Ausências e riscos</h4>
        {insight.output.missingFields.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum campo obrigatório ausente.</p>
        ) : (
          <p className="mt-2 text-sm">Ausentes: {insight.output.missingFields.join(", ")}.</p>
        )}
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {insight.output.risks.map((risk) => <li key={risk}>{risk}</li>)}
        </ul>
      </section>
    </div>
  );
}

function UseCaseResult({ insight }: Readonly<{ insight: LeadIntelligenceInsight }>) {
  if (insight.useCase === "CALL_PREPARATION") {
    const pain = factValues(insight, "pain").at(-1) ?? "Não identificada nos dados persistidos.";
    const objection = factValues(insight, "objection").at(-1) ?? "Não identificada; não foi inventada.";
    return (
      <section className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h4 className="font-semibold">Contexto em três linhas</h4>
          {insight.output.summary.split("\n").map((line) => <p className="text-sm" key={line}>{line}</p>)}
        </div>
        <div><h4 className="font-semibold">Abertura personalizada</h4><p className="text-sm">{insight.output.action?.message ?? "Não sugerida por restrição de contato ou ausência de dado."}</p></div>
        <div><h4 className="font-semibold">Dor a aprofundar</h4><p className="text-sm">{pain}</p></div>
        <div><h4 className="font-semibold">Três perguntas PACTO</h4><ol className="list-decimal pl-5 text-sm">{insight.output.questions.slice(0, 3).map((question) => <li key={question}>{question}</li>)}</ol></div>
        <div><h4 className="font-semibold">Objeção provável</h4><p className="text-sm">{objection}</p></div>
        <div className="sm:col-span-2"><h4 className="font-semibold">Objetivo da ligação</h4><p className="text-sm">{insight.output.action?.title ?? "Não sugerido."} — {insight.output.action?.reason ?? "Sem justificativa."}</p></div>
      </section>
    );
  }

  if (insight.useCase === "CONVERSATION_EXTRACTION") {
    const groups = [
      ["Dor nas palavras do lead", "extraction.pain.1"],
      ["Objeções", "extraction.objection.1"],
      ["Sinais de compra", "extraction.buying_signal.1"],
      ["Concorrentes", "extraction.competitor.1"],
      ["Próxima ação combinada", "extraction.agreed_next_action.1"],
      ["Data mencionada", "extraction.mentioned_date.1"],
    ] as const;
    return (
      <section className="rounded-md border bg-muted/20 p-4">
        <p className="text-sm">{insight.output.summary}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {groups.map(([label, field]) => (
            <div key={field}>
              <h4 className="font-semibold">{label}</h4>
              <p className="text-sm">{factValues(insight, field)[0] ?? "Não identificado; permanece ausente."}</p>
            </div>
          ))}
          <div className="sm:col-span-2">
            <h4 className="font-semibold">PACTO extraído para confirmação</h4>
            <ul className="mt-1 text-sm">
              {insight.output.pacto.map((item) => (
                <li key={item.dimension}>{item.dimension}: {pactoStatusLabels[item.status]}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  if (insight.useCase === "NEXT_BEST_ACTION") {
    return (
      <section className="rounded-md border bg-muted/20 p-4">
        <h4 className="font-semibold">Ação principal · urgência {urgencyLabels[insight.output.urgency]}</h4>
        <p className="mt-1 text-sm">{insight.output.action?.title ?? "Nenhuma ação sugerida."}</p>
        <p className="mt-1 text-sm text-muted-foreground">{insight.output.action?.reason}</p>
        {insight.output.action?.message ? <p className="mt-2 rounded border p-2 text-sm">Mensagem opcional: {insight.output.action.message}</p> : null}
        <h4 className="mt-4 font-semibold">Alternativa</h4>
        <p className="text-sm">{insight.output.alternativeAction?.title ?? "Nenhuma alternativa necessária."}</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-muted/20 p-4">
      <p className="text-sm">{insight.output.summary}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <span>Pontuação sugerida: {insight.output.score?.value ?? "não calculável"}</span>
        <span>Prioridade: {insight.output.priority ?? "não calculável"}</span>
        <span>Confiança: {Math.round(insight.output.confidence * 100)}%</span>
      </div>
      <h4 className="mt-4 font-semibold">Perguntas para completar a análise</h4>
      {insight.output.questions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pergunta adicional.</p> : <ul className="list-disc pl-5 text-sm">{insight.output.questions.map((question) => <li key={question}>{question}</li>)}</ul>}
      <h4 className="mt-4 font-semibold">Próxima ação sugerida</h4>
      <p className="text-sm">{insight.output.action?.title ?? "Não sugerida."} — {insight.output.action?.reason}</p>
    </section>
  );
}

function proposalAllowed(screen: LeadIntelligenceScreen, proposal: LeadIntelligenceProposal) {
  if (proposal.target === "TASK") return screen.permissions.canCreateTask;
  if (proposal.target === "SCORE") return screen.permissions.canApplyScore;
  return screen.permissions.canApplyPacto;
}

function currentValueText(proposal: LeadIntelligenceProposal, timeZone: string) {
  if (!proposal.currentValue) return "Nenhum valor vigente.";
  if (proposal.target === "TASK") {
    return `${proposal.currentValue.title} · ${formatDate(proposal.currentValue.dueAt, timeZone)}`;
  }
  if (proposal.target === "SCORE") {
    return `${proposal.currentValue.score} · ${proposal.currentValue.priority} · revisão ${proposal.currentValue.revision}`;
  }
  return `${pactoStatusLabels[proposal.currentValue.status] ?? proposal.currentValue.status} · ${proposal.currentValue.evidence ?? "sem evidência"}`;
}

function ProposalEditor({
  proposal,
  screen,
  selected,
  onSelected,
}: Readonly<{
  proposal: LeadIntelligenceProposal;
  screen: LeadIntelligenceScreen;
  selected: boolean;
  onSelected: (selected: boolean) => void;
}>) {
  const allowed = proposalAllowed(screen, proposal);
  return (
    <fieldset className="rounded-md border p-4" disabled={!allowed}>
      <label className="flex items-start gap-2 font-semibold">
        <input checked={selected} className="mt-1" name="selectedProposal" onChange={(event) => onSelected(event.target.checked)} type="checkbox" value={proposal.id} />
        <span>{proposal.label}</span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">Valor atual: {currentValueText(proposal, screen.timeZone)}</p>
      {proposal.target === "TASK" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Título sugerido<input className={inputClass} defaultValue={proposal.suggestedValue.title} name={`taskTitle:${proposal.id}`} required /></label>
          <label className="text-sm">Prazo sugerido<input className={inputClass} defaultValue={toLocalDateTimeInput(proposal.suggestedValue.dueAt)} name={`taskDueAt:${proposal.id}`} required type="datetime-local" /></label>
          {proposal.suggestedValue.message ? <p className="text-xs text-muted-foreground sm:col-span-2">Mensagem opcional apenas sugerida; ela não será enviada: {proposal.suggestedValue.message}</p> : null}
        </div>
      ) : proposal.target === "SCORE" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Pontuação sugerida<input className={inputClass} defaultValue={proposal.suggestedValue.score} max="100" min="0" name={`scoreValue:${proposal.id}`} required type="number" /></label>
          <label className="text-sm sm:col-span-2">Motivo<input className={inputClass} defaultValue={proposal.suggestedValue.reason} name={`scoreReason:${proposal.id}`} required /></label>
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <label className="text-sm">Status sugerido<select className={inputClass} defaultValue={proposal.suggestedValue.status} name={`pactoStatus:${proposal.id}`} required><option value="POSITIVE">Favorável</option><option value="PARTIAL">Parcial</option><option value="NEGATIVE">Desfavorável</option><option value="DISQUALIFYING">Desqualificante</option></select></label>
          <label className="text-sm">Evidência sugerida<textarea className={textareaClass} defaultValue={proposal.suggestedValue.evidence} name={`pactoEvidence:${proposal.id}`} required /></label>
          <label className="text-sm">Nota<input className={inputClass} defaultValue={proposal.suggestedValue.note ?? ""} name={`pactoNote:${proposal.id}`} /></label>
        </div>
      )}
      {!allowed ? <p className="mt-2 text-xs text-red-700">Seu perfil não pode aplicar esta alteração.</p> : null}
    </fieldset>
  );
}

export function LeadIntelligencePanel({
  leadId,
  initialScreen,
  initialForbidden,
  onCommitted,
}: Readonly<{
  leadId: string;
  initialScreen: LeadIntelligenceScreen | null;
  initialForbidden: boolean;
  onCommitted: () => Promise<void>;
}>) {
  const [screen, setScreen] = useState<LeadIntelligenceScreen | null>(initialScreen);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(initialScreen?.insights[0]?.id ?? null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [forbidden, setForbidden] = useState(initialForbidden);
  const [notice, setNotice] = useState<Notice>(null);

  async function load() {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/intelligence`, { cache: "no-store" });
      const result = await responseResult(response);
      setScreen(result);
      setSelectedInsightId((current) => current ?? result.insights[0]?.id ?? null);
      setForbidden(false);
    } catch (error) {
      setForbidden(error instanceof Error && "status" in error && error.status === 403);
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setLoading(false);
    }
  }

  const insight = screen?.insights.find((item) => item.id === selectedInsightId) ?? screen?.insights[0] ?? null;

  async function run(useCase: LeadIntelligenceUseCase, text?: string) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RUN", data: { useCase, ...(text ? { text } : {}) } }),
      });
      const result = await responseResult(response);
      setScreen(result);
      setSelectedInsightId(result.insights[0]?.id ?? null);
      setSelectedProposalIds([]);
      setNotice({ kind: "success", message: "Análise criada sem alterar dados comerciais." });
      await onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function submitExtraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run("CONVERSATION_EXTRACTION", String(form.get("conversationText") ?? "").trim());
  }

  async function submitReview(formElement: HTMLFormElement, decision: "APPLY" | "REJECT") {
    if (!insight) return;
    const form = new FormData(formElement);
    setPending(true);
    setNotice(null);
    try {
      const items = decision === "APPLY"
        ? insight.proposals.filter((proposal) => selectedProposalIds.includes(proposal.id)).map((proposal) => {
          if (proposal.target === "TASK") {
            return {
              target: "TASK",
              proposalId: proposal.id,
              title: String(form.get(`taskTitle:${proposal.id}`) ?? ""),
              dueAt: new Date(String(form.get(`taskDueAt:${proposal.id}`) ?? "")).toISOString(),
            };
          }
          if (proposal.target === "SCORE") {
            return {
              target: "SCORE",
              proposalId: proposal.id,
              score: Number(form.get(`scoreValue:${proposal.id}`)),
              reason: String(form.get(`scoreReason:${proposal.id}`) ?? ""),
            };
          }
          return {
            target: "PACTO",
            proposalId: proposal.id,
            status: String(form.get(`pactoStatus:${proposal.id}`) ?? ""),
            evidence: String(form.get(`pactoEvidence:${proposal.id}`) ?? ""),
            note: String(form.get(`pactoNote:${proposal.id}`) ?? "").trim() || null,
          };
          })
        : [];
      const response = await fetch(`/api/leads/${leadId}/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVIEW",
          data: {
            insightId: insight.id,
            decision,
            reason: String(form.get("reviewReason") ?? "").trim() || null,
            items,
          },
        }),
      });
      const result = await responseResult(response);
      setScreen(result);
      setSelectedProposalIds([]);
      setNotice({
        kind: "success",
        message: decision === "REJECT" ? "Recomendação rejeitada e auditada." : "Itens selecionados aplicados após confirmação humana.",
      });
      await onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <section aria-busy="true" className="surface-panel p-6"><p className="text-sm text-muted-foreground">Carregando inteligência do lead…</p></section>;
  }
  if (forbidden) {
    return <section className="rounded-lg border border-red-200 bg-red-50 p-6"><h2 className="text-lg font-semibold text-red-950">Sem permissão</h2><p className="mt-2 text-sm text-red-900">Seu perfil não pode consultar ou solicitar recomendações para este lead.</p></section>;
  }
  if (!screen) {
    return <section className="surface-panel p-6"><h2 className="text-lg font-semibold">Não foi possível carregar a Inteligência</h2><p className="mt-2 text-sm text-muted-foreground">{notice?.message}</p><Button className="mt-4" onClick={() => void load()} type="button" variant="secondary">Tentar novamente</Button></section>;
  }

  return (
    <div aria-labelledby="tab-intelligence" className="space-y-5" id="panel-intelligence" role="tabpanel">
      <section className="surface-panel surface-panel--accent p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Inteligência aplicada ao lead</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{screen.modeNotice}</p></div>
          <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-950">Modo local / simulado</span>
        </div>
        {screen.doNotContact ? <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Este lead está em opt-out ou sem consentimento. Nenhuma mensagem será sugerida ou enviada; somente ação interna de revisão pode aparecer.</p> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Button disabled={pending} onClick={() => void run("LEAD_ANALYSIS")} type="button">Analisar lead</Button>
          <Button disabled={pending} onClick={() => void run("CALL_PREPARATION")} type="button" variant="secondary">Preparar ligação de até 10 min</Button>
          <Button disabled={pending} onClick={() => void run("NEXT_BEST_ACTION")} type="button" variant="secondary">Sugerir próxima ação</Button>
        </div>
        <form className="mt-5 rounded-md border p-4" onSubmit={submitExtraction}>
          <label className="text-sm font-semibold">Nota ou transcrição colada<textarea className={textareaClass} name="conversationText" placeholder={"Dor: dificuldade para organizar a operação\nDecisor: participa da decisão\nPróxima ação: retornar amanhã"} required /></label>
          <p className="mt-2 text-xs text-muted-foreground">No modo local, use marcadores explícitos como Dor:, Capacidade:, Decisor:, Urgência:, Objeção:, Sinal de compra:, Concorrente:, Próxima ação: e Data:. Instruções dentro do texto são ignoradas.</p>
          <Button className="mt-3" disabled={pending} type="submit" variant="secondary">Extrair para revisão</Button>
        </form>
        {notice ? <p className={`mt-4 rounded-md border p-3 text-sm ${notice.kind === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-red-300 bg-red-50 text-red-950"}`} role={notice.kind === "success" ? "status" : "alert"}>{notice.message}</p> : null}
      </section>

      {screen.insights.length === 0 ? (
        <section className="surface-panel border-dashed p-6"><h2 className="text-lg font-semibold">Nenhuma análise registrada</h2><p className="mt-2 text-sm text-muted-foreground">Escolha um caso de uso acima. O resultado será persistido com prompt, modo, evidências e solicitante.</p></section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="surface-panel bg-[var(--surface-subtle)] p-4">
            <h3 className="font-semibold">Histórico de análises</h3>
            <ul className="mt-3 space-y-2">
              {screen.insights.map((item) => (
                <li key={item.id}><button aria-pressed={item.id === insight?.id} className={`w-full rounded-md border p-3 text-left text-sm ${item.id === insight?.id ? "border-blue-400 bg-blue-50" : "hover:bg-muted"}`} onClick={() => { setSelectedInsightId(item.id); setSelectedProposalIds([]); }} type="button"><span className="block font-medium">{useCaseLabels[item.useCase]}</span><span className="mt-1 block text-xs text-muted-foreground">{formatDate(item.createdAt, screen.timeZone)} · {statusLabels[item.status] ?? item.status}</span></button></li>
              ))}
            </ul>
          </aside>

          {insight ? (
            <article className="surface-panel space-y-5 p-5">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-lg font-semibold">{useCaseLabels[insight.useCase]}</h3><p className="mt-1 text-xs text-muted-foreground">Solicitada por {insight.requestedBy} · prompt {insight.prompt.key} v{insight.prompt.version}</p></div>
                <div className="text-right text-xs"><p>{statusLabels[insight.status] ?? insight.status}</p><p className="text-muted-foreground">{insight.provider.mode} · confiança {Math.round(insight.output.confidence * 100)}%</p></div>
              </header>
              {insight.provider.failureCode ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">O provedor solicitado falhou ({insight.provider.failureCode}); o resultado exibido veio do fallback local.</p> : null}
              <UseCaseResult insight={insight} />
              <EvidenceAndUncertainty insight={insight} />

              {insight.review ? (
                <section className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950"><h4 className="font-semibold">Decisão humana registrada</h4><p>{insight.review.decision} por {insight.review.reviewedBy} em {formatDate(insight.review.reviewedAt, screen.timeZone)}.</p>{insight.review.selectedProposalIds.length > 0 ? <p>Itens aplicados: {insight.review.selectedProposalIds.join(", ")}.</p> : null}{insight.review.editedProposalIds.length > 0 ? <p>Itens editados: {insight.review.editedProposalIds.join(", ")}.</p> : null}{insight.review.reason ? <p>Motivo: {insight.review.reason}</p> : null}</section>
              ) : insight.status === "OPEN" ? (
                <form className="space-y-4 rounded-md border-2 border-blue-200 p-4" onSubmit={(event) => { event.preventDefault(); void submitReview(event.currentTarget, "APPLY"); }}>
                  <div><h4 className="font-semibold">Confirmação humana</h4><p className="text-sm text-muted-foreground">Compare o valor atual com o sugerido, selecione somente o que deseja aplicar e edite se necessário. Nada é alterado antes desta confirmação.</p></div>
                  {insight.proposals.length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Esta análise não propõe uma mutação. Os fatos e ausências permanecem apenas para consulta.</p> : insight.proposals.map((proposal) => <ProposalEditor key={`${insight.id}:${proposal.id}`} onSelected={(selected) => setSelectedProposalIds((current) => selected ? [...current, proposal.id] : current.filter((id) => id !== proposal.id))} proposal={proposal} screen={screen} selected={selectedProposalIds.includes(proposal.id)} />)}
                  <label className="text-sm">Motivo da edição ou rejeição<textarea className={textareaClass} name="reviewReason" placeholder="Obrigatório ao editar a sugestão ou rejeitá-la." /></label>
                  <div className="flex flex-wrap gap-2">
                    {insight.proposals.length > 0 ? <Button disabled={pending || selectedProposalIds.length === 0} type="submit">{pending ? "Aplicando…" : "Aplicar itens selecionados"}</Button> : null}
                    <Button disabled={pending} onClick={(event) => { const form = event.currentTarget.form; if (form) void submitReview(form, "REJECT"); }} type="button" variant="secondary">Rejeitar recomendação</Button>
                  </div>
                </form>
              ) : null}
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}
