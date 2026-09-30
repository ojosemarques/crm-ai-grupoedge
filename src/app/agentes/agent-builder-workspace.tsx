"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import styles from "./agents-workspace.module.css";

export type AgentDefinition = Readonly<{
  instructions: string;
  tone: string;
  audience: string;
  offerScope: string;
  model: string;
  budgetCents: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedDataFields: readonly string[];
  allowedTools: readonly string[];
  knowledge: Readonly<{ title: string; content: string; sourceReference: string }>;
}>;

type Evaluation = Readonly<{
  passed: boolean;
  grounding: boolean;
  futureOffer: boolean;
  pii: boolean;
  promptInjection: boolean;
  lowConfidenceHandoff: boolean;
  sensitiveApproval: boolean;
  issues: readonly string[];
}>;

type Option = Readonly<{ key: string; label: string }>;

export type AgentsScreen = Readonly<{
  generatedAt: string;
  providerGate: Readonly<{ approved: boolean; mode: string }>;
  capabilities: Readonly<{ canRead: boolean; canManage: boolean; canEvaluate: boolean; canUse: boolean }>;
  agents: readonly Readonly<{
    id: string; key: string; name: string; objective: string; status: string; draftRevision: number; activeVersionId: string | null;
    draftDefinition: AgentDefinition;
    versions: readonly Readonly<{ id: string; version: number; status: string; definition: AgentDefinition; knowledgeBaseVersion: number; evaluation: Evaluation; createdAt: string }>[];
  }>[];
  subagents: readonly Readonly<{ key: string; name: string; status: "DRAFT"; specialty: string }>[];
  leases: readonly Readonly<{ conversationId: string; agentId: string; status: string; pausedReason: string | null; humanOwnerMemberId: string | null; updatedAt: string }>[];
  metrics: Readonly<{ cases: number; corrections: number; totalCostCents: number; averageCostCents: number; handoffs: number; sensitiveApprovalsPending: number }>;
  catalog: Readonly<{
    models: readonly Readonly<Option & { external: false }>[];
    tones: readonly Option[];
    allowedTools: readonly Readonly<Option & { sensitive: boolean }>[];
    allowedDataFields: readonly Option[];
    activeProductsOnly: boolean;
    osCitizenDataSeparated: boolean;
  }>;
}>;

type SimulationResult = Readonly<{
  turnId: string;
  response: string | null;
  status: "RESPONDED" | "HANDOFF" | "BLOCKED" | "PENDING_APPROVAL";
  confidenceBps: number;
  intent: "QUALIFICATION" | "INFORMATION" | "COMMERCIAL" | "SENSITIVE" | "UNKNOWN";
  handoffReason: string | null;
  noResponse: boolean;
  sources: readonly Readonly<{ title: string; reference: string }>[];
  proposedFields: Readonly<Record<string, string>>;
  summary: string | null;
  costCents: number;
  externalEgress: false;
}>;

type DefinitionDraft = {
  name: string; objective: string; instructions: string; tone: string; audience: string; offerScope: string; model: string;
  budgetCents: string; maxInputTokens: string; maxOutputTokens: string; allowedDataFields: string[]; allowedTools: string[];
  knowledgeTitle: string; knowledgeContent: string; knowledgeSourceReference: string;
};

const statusLabels: Record<string, string> = { DRAFT: "Rascunho", ACTIVE: "Agente ativo", PAUSED: "Pausado", HUMAN_PAUSED: "Humano responsável", RESPONDED: "Respondeu", HANDOFF: "Handoff", BLOCKED: "Bloqueado", PENDING_APPROVAL: "Aprovação pendente" };
const intentLabels: Record<string, string> = { QUALIFICATION: "Qualificação", INFORMATION: "Informação", COMMERCIAL: "Comercial", SENSITIVE: "Sensível", UNKNOWN: "Não identificada" };
const evaluationLabels: ReadonlyArray<readonly [keyof Omit<Evaluation, "passed" | "issues">, string]> = [["grounding", "Grounding e fontes"], ["futureOffer", "Oferta futura"], ["pii", "Dados pessoais"], ["promptInjection", "Prompt injection"], ["lowConfidenceHandoff", "Baixa confiança e handoff"], ["sensitiveApproval", "Ações sensíveis"]];

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function draftFor(screen: AgentsScreen, agent?: AgentsScreen["agents"][number]): DefinitionDraft {
  const definition = agent?.draftDefinition;
  return {
    name: agent?.name ?? "", objective: agent?.objective ?? "", instructions: definition?.instructions ?? "",
    tone: definition?.tone ?? screen.catalog.tones[0]?.key ?? "", audience: definition?.audience ?? "", offerScope: definition?.offerScope ?? "",
    model: definition?.model ?? screen.catalog.models[0]?.key ?? "", budgetCents: String(definition?.budgetCents ?? 100),
    maxInputTokens: String(definition?.maxInputTokens ?? 1200), maxOutputTokens: String(definition?.maxOutputTokens ?? 500),
    allowedDataFields: [...(definition?.allowedDataFields ?? [])], allowedTools: [...(definition?.allowedTools ?? [])],
    knowledgeTitle: definition?.knowledge.title ?? "", knowledgeContent: definition?.knowledge.content ?? "", knowledgeSourceReference: definition?.knowledge.sourceReference ?? "",
  };
}

export function AgentBuilderWorkspace({ initial }: Readonly<{ initial: AgentsScreen }>) {
  const [screen, setScreen] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial.agents[0]?.id ?? "");
  const [creating, setCreating] = useState(initial.agents.length === 0);
  const selected = screen.agents.find((agent) => agent.id === selectedId);
  const [draft, setDraft] = useState<DefinitionDraft>(() => draftFor(initial, initial.agents[0]));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [simulationMode, setSimulationMode] = useState<"SIMULATE" | "START_CONVERSATION">("SIMULATE");
  const [message, setMessage] = useState("Quero entender qual solução ativa atende minha operação comercial.");
  const [conversationId, setConversationId] = useState("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [evaluationPreview, setEvaluationPreview] = useState<Evaluation | null>(null);

  async function refresh(preferredId?: string) {
    const response = await fetch("/api/ai/agents", { cache: "no-store" });
    const payload = await response.json() as { result?: AgentsScreen; error?: { message?: string } };
    if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "Não foi possível atualizar os agentes.");
    setScreen(payload.result);
    const nextId = preferredId || selectedId || payload.result.agents[0]?.id || "";
    setSelectedId(nextId);
    const next = payload.result.agents.find((agent) => agent.id === nextId);
    if (next) setDraft(draftFor(payload.result, next));
  }

  async function command(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(action); setNotice(null);
    try {
      const response = await fetch("/api/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
      const body = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "A ação não foi concluída.");
      setNotice({ tone: "success", text: success });
      await refresh();
      return body.result;
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A ação não foi concluída." });
      return null;
    } finally { setBusy(null); }
  }

  function selectAgent(agent: AgentsScreen["agents"][number]) {
    setSelectedId(agent.id); setCreating(false); setDraft(draftFor(screen, agent)); setSimulation(null); setEvaluationPreview(null); setNotice(null);
  }

  function startCreate() {
    setCreating(true); setSelectedId(""); setDraft(draftFor(screen)); setSimulation(null); setEvaluationPreview(null); setNotice(null);
  }

  function toggle(key: "allowedDataFields" | "allowedTools", value: string) {
    setDraft((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      ...(creating ? {} : { agentId: selected!.id, expectedRevision: selected!.draftRevision }), name: draft.name, objective: draft.objective,
      definition: { instructions: draft.instructions, tone: draft.tone, audience: draft.audience, offerScope: draft.offerScope, model: draft.model,
        budgetCents: Number(draft.budgetCents), maxInputTokens: Number(draft.maxInputTokens), maxOutputTokens: Number(draft.maxOutputTokens),
        allowedDataFields: draft.allowedDataFields, allowedTools: draft.allowedTools,
        knowledge: { title: draft.knowledgeTitle, content: draft.knowledgeContent, sourceReference: draft.knowledgeSourceReference } },
    };
    await command(creating ? "CREATE_AGENT" : "SAVE_DRAFT", payload, creating ? "Agente criado em rascunho." : "Rascunho salvo com nova revisão.");
    setEvaluationPreview(null);
    setCreating(false);
  }

  async function evaluate() {
    if (!selected) return;
    const result = await command("EVALUATE", { agentId: selected.id }, "Avaliação local concluída.");
    if (result) setEvaluationPreview(result as Evaluation);
  }

  async function simulate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(simulationMode); setNotice(null); setSimulation(null);
    try {
      const payload = simulationMode === "SIMULATE" ? { agentId: selected.id, message, conversationId: conversationId || undefined } : { agentId: selected.id, message, conversationId, idempotencyKey: `agents-ui:${crypto.randomUUID()}` };
      const response = await fetch("/api/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: simulationMode, payload }) });
      const body = await response.json() as { result?: SimulationResult; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "A simulação não foi concluída.");
      setSimulation(body.result);
      setNotice({ tone: "success", text: body.result.externalEgress ? "Execução concluída." : "Execução determinística local concluída sem egress externo." });
      await refresh(selected.id);
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A simulação não foi concluída." }); }
    finally { setBusy(null); }
  }

  const latestEvaluation = evaluationPreview ?? selected?.versions.find((version) => version.id === selected.activeVersionId)?.evaluation ?? selected?.versions.at(0)?.evaluation;
  return <div className={`${styles.workspace} space-y-5`}>
    <Surface tone={screen.providerGate.approved ? "accent" : "critical"}><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader eyebrow="Gate do provedor" title={screen.providerGate.approved ? "Provider aprovado" : "Execução externa bloqueada"} description="O construtor opera em modo determinístico local. Publicação governa versões e uso interno; não habilita provider nem egress externo." /><span className="status-badge" data-tone={screen.providerGate.approved ? "success" : "danger"}>{screen.providerGate.mode}</span></div></Surface>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><StatCard label="Casos" value={screen.metrics.cases} hint="Execuções governadas" /><StatCard label="Correções" value={screen.metrics.corrections} hint="Decisões humanas" /><StatCard label="Custo total" value={money(screen.metrics.totalCostCents)} hint="Contabilidade local" /><StatCard label="Custo médio" value={money(screen.metrics.averageCostCents)} hint="Por caso" /><StatCard label="Handoffs" value={screen.metrics.handoffs} hint="Posse transferida" /><StatCard label="Aprovações" value={screen.metrics.sensitiveApprovalsPending} hint="Ações sensíveis" /></div>
    {notice ? <p className="feedback-banner" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Surface><div className="flex items-center justify-between gap-2"><SectionHeader title="Agentes" description="Rascunho, versão ativa e estado operacional." />{screen.capabilities.canManage ? <Button onClick={startCreate} size="sm">Novo</Button> : null}</div><div className="mt-4 space-y-2">{screen.agents.map((agent) => <button className={`w-full rounded-[var(--radius-control)] border p-3 text-left ${selected?.id === agent.id && !creating ? "border-primary bg-[var(--surface-subtle)]" : "bg-card"}`} key={agent.id} onClick={() => selectAgent(agent)} type="button"><span className="flex items-center justify-between gap-2"><strong className="text-sm">{agent.name}</strong><span className="status-badge" data-tone={agent.status === "ACTIVE" ? "success" : agent.status === "PAUSED" ? "warning" : "info"}>{statusLabels[agent.status] ?? agent.status}</span></span><span className="mt-1 block text-xs text-muted-foreground">{agent.objective}</span></button>)}{screen.agents.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum agente criado.</p> : null}</div></Surface>

      {(creating || selected) ? <Surface><SectionHeader eyebrow={creating ? "Novo rascunho" : `${selected!.key} · revisão ${selected!.draftRevision}`} title={creating ? "Criar agente governado" : `Editar ${selected!.name}`} description="Campos estruturados substituem configuração livre. A base fica versionada com fonte explícita." /><form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={save}><Field label="Nome"><input className={styles.input} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></Field><Field label="Objetivo"><input className={styles.input} maxLength={500} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} required value={draft.objective} /></Field><Field className="md:col-span-2" label="Instruções"><textarea className={`${styles.input} min-h-32`} maxLength={12000} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} required value={draft.instructions} /></Field><Field label="Tom"><select className={styles.input} onChange={(event) => setDraft({ ...draft, tone: event.target.value })} required value={draft.tone}>{screen.catalog.tones.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field><Field label="Modelo lógico"><select className={styles.input} onChange={(event) => setDraft({ ...draft, model: event.target.value })} required value={draft.model}>{screen.catalog.models.map((item) => <option key={item.key} value={item.key}>{item.label} · local</option>)}</select></Field><Field label="Público"><input className={styles.input} maxLength={500} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} required value={draft.audience} /></Field><Field label="Escopo de oferta ativa"><input className={styles.input} maxLength={500} onChange={(event) => setDraft({ ...draft, offerScope: event.target.value })} required value={draft.offerScope} /></Field><Field label="Orçamento por caso (centavos)"><input className={styles.input} min="0" onChange={(event) => setDraft({ ...draft, budgetCents: event.target.value })} required type="number" value={draft.budgetCents} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Tokens de entrada"><input className={styles.input} min="100" onChange={(event) => setDraft({ ...draft, maxInputTokens: event.target.value })} required type="number" value={draft.maxInputTokens} /></Field><Field label="Tokens de saída"><input className={styles.input} min="50" onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value })} required type="number" value={draft.maxOutputTokens} /></Field></div><ChoiceGroup legend="Dados permitidos" options={screen.catalog.allowedDataFields} selected={draft.allowedDataFields} toggle={(value) => toggle("allowedDataFields", value)} /><ChoiceGroup legend="Ferramentas permitidas" options={screen.catalog.allowedTools} selected={draft.allowedTools} sensitive toggle={(value) => toggle("allowedTools", value)} /><Field label="Título da base"><input className={styles.input} maxLength={200} onChange={(event) => setDraft({ ...draft, knowledgeTitle: event.target.value })} required value={draft.knowledgeTitle} /></Field><Field label="Referência da fonte"><input className={styles.input} maxLength={500} onChange={(event) => setDraft({ ...draft, knowledgeSourceReference: event.target.value })} placeholder="Catálogo ativo · versão/data" required value={draft.knowledgeSourceReference} /></Field><Field className="md:col-span-2" label="Conteúdo aprovado da base"><textarea className={`${styles.input} min-h-36`} maxLength={30000} onChange={(event) => setDraft({ ...draft, knowledgeContent: event.target.value })} required value={draft.knowledgeContent} /></Field><div className="flex flex-wrap justify-end gap-2 md:col-span-2">{creating && screen.agents.length ? <Button onClick={() => selectAgent(screen.agents[0]!)} type="button" variant="ghost">Cancelar</Button> : null}<Button disabled={busy !== null || !screen.capabilities.canManage} type="submit">{busy === "CREATE_AGENT" || busy === "SAVE_DRAFT" ? "Salvando…" : "Salvar rascunho"}</Button></div></form></Surface> : <EmptyState description="Crie ou selecione um agente para editar sua definição." title="Nenhum agente selecionado" />}
    </div>

    {selected ? <div className="grid gap-5 xl:grid-cols-2"><Surface><SectionHeader title="Avaliação e ciclo de vida" description="A publicação depende de todos os gates locais; versões publicadas permanecem imutáveis." />{latestEvaluation ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{evaluationLabels.map(([key, label]) => <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border p-3 text-sm" key={key}><span>{label}</span><span className="status-badge" data-tone={latestEvaluation[key] ? "success" : "danger"}>{latestEvaluation[key] ? "Passou" : "Falhou"}</span></div>)}{latestEvaluation.issues.length ? <ul className="list-disc pl-5 text-sm text-red-800 sm:col-span-2">{latestEvaluation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</div> : <p className="mt-4 text-sm text-muted-foreground">Avalie o rascunho antes de publicar.</p>}<div className="mt-4 flex flex-wrap gap-2">{screen.capabilities.canEvaluate ? <Button disabled={busy !== null} onClick={() => void evaluate()} variant="secondary">Avaliar rascunho</Button> : null}{screen.capabilities.canManage ? <Button disabled={busy !== null || !evaluationPreview?.passed} onClick={() => void command("PUBLISH", { agentId: selected.id, reason: "Gates locais revisados no construtor visual." }, "Versão publicada para uso local governado.")}>{selected.status === "ACTIVE" ? "Publicar nova versão" : "Publicar"}</Button> : null}{screen.capabilities.canManage && selected.status === "ACTIVE" ? <Button disabled={busy !== null} onClick={() => void command("PAUSE", { agentId: selected.id, reason: "Pausa operacional solicitada no construtor." }, "Agente pausado para novas execuções.")} variant="secondary">Pausar</Button> : null}{screen.capabilities.canManage && selected.versions.length > 1 ? <select aria-label="Versão para rollback" className={`${styles.input} max-w-48`} defaultValue="" onChange={(event) => { if (event.target.value) void command("ROLLBACK", { agentId: selected.id, targetVersionId: event.target.value, reason: "Rollback selecionado no histórico visual." }, "Rollback publicado como nova versão."); }}><option value="">Reverter para…</option>{selected.versions.filter((version) => version.id !== selected.activeVersionId).map((version) => <option key={version.id} value={version.id}>Versão {version.version}</option>)}</select> : null}</div><div className="mt-4 space-y-2">{selected.versions.map((version) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border p-3 text-sm" key={version.id}><span><strong>v{version.version}</strong> · KB v{version.knowledgeBaseVersion} · {date(version.createdAt)}</span><span className="status-badge" data-tone={version.id === selected.activeVersionId ? "success" : "info"}>{version.id === selected.activeVersionId ? "Ativa" : version.status}</span></div>)}</div></Surface>

    <Surface><SectionHeader title="Simular conversa" description="Teste resposta, intenção, campos propostos, falta de resposta e handoff. A simulação nunca envia mensagem externa." /><form className="mt-4 space-y-4" onSubmit={simulate}><div className="grid gap-3 sm:grid-cols-2"><Field label="Modo"><select className={styles.input} onChange={(event) => setSimulationMode(event.target.value as typeof simulationMode)} value={simulationMode}><option value="SIMULATE">Prévia isolada</option><option value="START_CONVERSATION">Iniciar em conversa canônica</option></select></Field><Field label={simulationMode === "START_CONVERSATION" ? "ID da conversa" : "ID da conversa opcional"}><input className={`${styles.input} font-mono text-xs`} onChange={(event) => setConversationId(event.target.value)} required={simulationMode === "START_CONVERSATION"} value={conversationId} /></Field></div><Field label="Mensagem de teste"><textarea className={`${styles.input} min-h-24`} maxLength={4000} onChange={(event) => setMessage(event.target.value)} required value={message} /></Field><Button disabled={busy !== null || !screen.capabilities.canUse} type="submit">{busy === simulationMode ? "Executando…" : "Executar localmente"}</Button></form>{simulation ? <SimulationEvidence result={simulation} approve={(decision) => void command("APPROVE_SENSITIVE", { turnId: simulation.turnId, decision, reason: decision === "APPROVE" ? "Ação revisada e aprovada por humano." : "Ação rejeitada após revisão humana." }, `Ação sensível ${decision === "APPROVE" ? "aprovada" : "rejeitada"}.`)} /> : null}</Surface></div> : null}

    <div className="grid gap-5 xl:grid-cols-2"><Surface><SectionHeader title="Posse das conversas" description="Uma conversa pertence ao agente ou ao humano. Resposta humana pausa o agente; retomada exige novo gatilho idempotente." />{screen.leases.length ? <div className="mt-4 space-y-3">{screen.leases.map((lease) => <article className="rounded-[var(--radius-control)] border p-3" key={lease.conversationId}><div className="flex flex-wrap items-center justify-between gap-2"><code className="text-xs">{lease.conversationId}</code><span className="status-badge" data-tone={lease.status === "ACTIVE" ? "success" : "warning"}>{statusLabels[lease.status] ?? lease.status}</span></div><p className="mt-2 text-xs text-muted-foreground">{lease.pausedReason ?? "Sem pausa"} · atualizado {date(lease.updatedAt)}</p><div className="mt-3 flex gap-2">{lease.status === "ACTIVE" ? <Button disabled={busy !== null} onClick={() => void command("HUMAN_REPLY", { conversationId: lease.conversationId, reason: "Humano assumiu a conversa pelo construtor." }, "Conversa transferida ao humano sem mensagem concorrente.")} size="sm" variant="secondary">Humano assumiu</Button> : <Button disabled={busy !== null} onClick={() => void command("RESUME", { conversationId: lease.conversationId, idempotencyKey: `resume-ui:${crypto.randomUUID()}` }, "Novo gatilho retomou a conversa.")} size="sm" variant="secondary">Retomar por novo gatilho</Button>}</div></article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma posse ativa neste recorte.</p>}</Surface>

    <Surface><SectionHeader title="Subagentes Politizai" description="Especialistas internos pré-configurados em rascunho, limitados ao catálogo ativo e ao contexto comercial." /><div className="mt-4 grid gap-2 sm:grid-cols-2">{screen.subagents.map((agent) => <article className="rounded-[var(--radius-control)] border p-3" key={agent.key}><div className="flex items-center justify-between gap-2"><strong className="text-sm">{agent.name}</strong><span className="status-badge" data-tone="info">Rascunho</span></div><p className="mt-1 text-xs text-muted-foreground">{agent.specialty}</p></article>)}</div><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p className="rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3"><strong>Catálogo ativo:</strong> {screen.catalog.activeProductsOnly ? "obrigatório" : "não comprovado"}</p><p className="rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3"><strong>Dados de cidadãos do OS:</strong> {screen.catalog.osCitizenDataSeparated ? "separados" : "bloqueio não comprovado"}</p></div></Surface></div>
  </div>;
}

function Field({ children, className = "", label }: Readonly<{ children: React.ReactNode; className?: string; label: string }>) {
  return <label className={`space-y-1 text-sm ${className}`}><span className="font-semibold">{label}</span>{children}</label>;
}

function ChoiceGroup({ legend, options, selected, sensitive = false, toggle }: Readonly<{ legend: string; options: readonly (Option & { sensitive?: boolean })[]; selected: readonly string[]; sensitive?: boolean; toggle: (value: string) => void }>) {
  return <fieldset className="rounded-[var(--radius-panel)] border p-4"><legend className="px-1 text-sm font-semibold">{legend}</legend><div className="grid gap-2">{options.map((option) => <label className="flex items-start gap-2 text-sm" key={option.key}><input checked={selected.includes(option.key)} className="mt-1" onChange={() => toggle(option.key)} type="checkbox" /><span>{option.label}{sensitive && option.sensitive ? <small className="ml-1 text-amber-700">aprovação humana</small> : null}</span></label>)}</div></fieldset>;
}

function SimulationEvidence({ approve, result }: Readonly<{ approve: (decision: "APPROVE" | "REJECT") => void; result: SimulationResult }>) {
  return <div className="mt-5 space-y-4 rounded-[var(--radius-panel)] border bg-[var(--surface-subtle)] p-4"><div className="flex flex-wrap items-center gap-2"><span className="status-badge" data-tone={result.status === "RESPONDED" ? "success" : result.status === "BLOCKED" ? "danger" : "warning"}>{statusLabels[result.status]}</span><span className="status-badge">{intentLabels[result.intent]}</span><span className="status-badge">Confiança {(result.confidenceBps / 100).toFixed(1)}%</span><span className="status-badge" data-tone="success">Sem egress</span></div>{result.response ? <div><h3 className="text-sm font-semibold">Resposta</h3><p className="mt-1 whitespace-pre-wrap text-sm">{result.response}</p></div> : <p className="text-sm text-muted-foreground">Sem resposta gerada{result.noResponse ? "; o fluxo deve seguir a ramificação de ausência" : ""}.</p>}{result.summary ? <div><h3 className="text-sm font-semibold">Resumo para handoff</h3><p className="mt-1 text-sm">{result.summary}</p></div> : null}{result.handoffReason ? <p className="text-sm"><strong>Motivo do handoff:</strong> {result.handoffReason}</p> : null}<div className="grid gap-4 sm:grid-cols-2"><div><h3 className="text-sm font-semibold">Fontes</h3>{result.sources.length ? <ul className="mt-1 space-y-1 text-sm">{result.sources.map((source) => <li key={`${source.title}:${source.reference}`}><strong>{source.title}</strong> · {source.reference}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Nenhuma fonte retornada.</p>}</div><div><h3 className="text-sm font-semibold">Campos propostos</h3>{Object.entries(result.proposedFields).length ? <dl className="mt-1 space-y-1 text-sm">{Object.entries(result.proposedFields).map(([key, value]) => <div className="flex justify-between gap-3" key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p className="mt-1 text-sm text-muted-foreground">Nenhum campo proposto.</p>}</div></div><p className="text-xs text-muted-foreground">Custo do caso: {money(result.costCents)} · alterações comerciais continuam pendentes de decisão humana.</p>{result.status === "PENDING_APPROVAL" ? <div className="flex gap-2"><Button onClick={() => approve("APPROVE")} size="sm">Aprovar ação sensível</Button><Button onClick={() => approve("REJECT")} size="sm" variant="secondary">Rejeitar</Button></div> : null}</div>;
}
