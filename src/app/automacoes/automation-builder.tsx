"use client";

import { useEffect, useState } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AutomationGraph, AutomationGraphNode } from "@/modules/automations/domain/automation-graph-contracts";
import styles from "./automations-workspace.module.css";

type BuilderRule = Readonly<{ id: string; key: string; name: string; description: string; status: string; draftRevision: number; draftDefinition: AutomationGraph | null; publishedVersionId: string | null; version: number; versions: ReadonlyArray<Readonly<{ id: string; version: number; graphDefinition: AutomationGraph; graphHash: string; publishedAt: string; rollbackOfVersionId: string | null }>> }>;
type BuilderRun = Readonly<{ id: string; automationRuleId: string; automationRuleVersionId: string | null; status: string; currentNodeId: string | null; executionPolicy: string; triggeredAt: string; nodeRuns: ReadonlyArray<Readonly<{ id?: string; nodeId: string; nodeType: string; status: string; errorCode?: string | null; errorMessage?: string | null }>> }>;
type BuilderScreen = Readonly<{ generatedAt: string; capabilities: Readonly<{ canManage: boolean; canExecute: boolean }>; catalog: Readonly<{ schema: "automation.graph/v1"; nodeTypes: readonly AutomationGraphNode["type"][]; triggerTypes: readonly AutomationGraphNode["type"][]; actionTypes: readonly AutomationGraphNode["type"][]; executionPolicy: string }>; rules: readonly BuilderRule[]; runs: readonly BuilderRun[]; insights: Readonly<{ runsByStatus: unknown; nodeFailures: unknown; humanPauses: unknown; replays: unknown; nodes: ReadonlyArray<Readonly<{ nodeType: string; status: string; count: number }>> }>; conflicts: ReadonlyArray<Readonly<{ triggerType: string; ruleNames: readonly string[]; severity: string }>> }>;
type CommandResult = Record<string, unknown>;

const nodeLabels: Record<AutomationGraphNode["type"], string> = { TRIGGER_CONTACT: "Contato criado/alterado", TRIGGER_OPPORTUNITY: "Negócio criado/alterado", TRIGGER_FIELD: "Campo alterado", TRIGGER_TIME: "Tempo ou data", TRIGGER_CHANNEL: "Evento de canal", TRIGGER_CAMPAIGN: "Evento de campanha", TRIGGER_MANUAL: "Início manual", CONDITION: "Condição E/OU", DELAY: "Espera", SCHEDULE_WINDOW: "Janela de horário", ACTION_CREATE_TASK: "Criar tarefa", ACTION_TRIAGE: "Triagem", ACTION_TAG: "Aplicar tag", ACTION_ASSIGN: "Atribuir responsável", ACTION_NOTIFICATION: "Criar notificação", HUMAN_HANDOFF: "Pausa e handoff humano", END: "Encerrar fluxo" };

const statusLabel = (value: string) => ({ DRAFT: "Rascunho", ACTIVE: "Ativa", PAUSED: "Pausada", PENDING: "Pendente", RUNNING: "Executando", SUCCEEDED: "Sucesso", FAILED: "Falha", CANCELLED: "Cancelada" } as Record<string, string>)[value] ?? value;
const statusTone = (value: string) => value === "ACTIVE" || value === "SUCCEEDED" ? "success" : value === "FAILED" ? "danger" : value === "RUNNING" || value === "PENDING" ? "warning" : "neutral";
const nodeId = () => `node_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
const edgeId = () => `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

function acceptanceGraph(): AutomationGraph {
  return { schema: "automation.graph/v1", name: "Lead com triagem e handoff", description: "Lead → triagem → tarefa → espera → condição → handoff", maxEstimatedCostCents: 500, nodes: [
    { id: "lead", type: "TRIGGER_CONTACT", label: "Novo lead", config: { event: "CREATED" }, estimatedCostCents: 0 },
    { id: "triage", type: "ACTION_TRIAGE", label: "Triar lead", config: { strategy: "RULES" }, estimatedCostCents: 10 },
    { id: "task", type: "ACTION_CREATE_TASK", label: "Criar tarefa de contato", config: { title: "Entrar em contato com o lead" }, estimatedCostCents: 0 },
    { id: "wait", type: "DELAY", label: "Esperar 30 minutos", config: { minutes: 30 }, estimatedCostCents: 0 },
    { id: "condition", type: "CONDITION", label: "Lead está qualificado?", config: { mode: "ALL", rules: [{ path: "lead.status", operator: "EQUALS", value: "QUALIFIED" }] }, estimatedCostCents: 0 },
    { id: "handoff", type: "HUMAN_HANDOFF", label: "Entregar ao atendente", config: { reason: "Lead qualificado exige atendimento humano" }, estimatedCostCents: 0 },
    { id: "end_yes", type: "END", label: "Concluir com handoff", config: {}, estimatedCostCents: 0 },
    { id: "end_no", type: "END", label: "Concluir sem handoff", config: {}, estimatedCostCents: 0 },
  ], edges: [
    { id: "e1", source: "lead", target: "triage", branch: "ALWAYS" }, { id: "e2", source: "triage", target: "task", branch: "ALWAYS" }, { id: "e3", source: "task", target: "wait", branch: "ALWAYS" }, { id: "e4", source: "wait", target: "condition", branch: "ALWAYS" }, { id: "e5", source: "condition", target: "handoff", branch: "TRUE" }, { id: "e6", source: "condition", target: "end_no", branch: "FALSE" }, { id: "e7", source: "handoff", target: "end_yes", branch: "ALWAYS" },
  ] };
}

function summarizeConfig(node: AutomationGraphNode) {
  if (node.type === "DELAY") return `${String(node.config.minutes ?? "?")} min`;
  if (node.type === "CONDITION") return `${node.config.mode === "ANY" ? "OU" : "E"} · ${Array.isArray(node.config.rules) ? node.config.rules.length : 0} regra(s)`;
  if (node.type === "SCHEDULE_WINDOW") return `${String(node.config.startMinute ?? "?")}–${String(node.config.endMinute ?? "?")} min`;
  if (node.type === "HUMAN_HANDOFF") return "Pausa obrigatória";
  return Object.values(node.config).filter((value) => typeof value === "string" || typeof value === "number").slice(0, 2).join(" · ") || "Sem parâmetros";
}

function numericInsight(value: unknown) {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).reduce<number>((sum, item) => sum + (typeof item === "number" ? item : 0), 0);
  return 0;
}

export function AutomationBuilder() {
  const [screen, setScreen] = useState<BuilderScreen | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [graph, setGraph] = useState<AutomationGraph>(acceptanceGraph);
  const [selectedNodeId, setSelectedNodeId] = useState("lead");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [validation, setValidation] = useState<{ valid?: boolean; issues?: readonly string[]; estimatedCostCents?: number } | null>(null);
  const [simulation, setSimulation] = useState<CommandResult | null>(null);
  const [rollback, setRollback] = useState<{ versionId: string; version: number } | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("Retorno operacional para versão estável revisada.");
  const [runLeadId, setRunLeadId] = useState("");
  const [runField, setRunField] = useState("lead.status");
  const [runValue, setRunValue] = useState("QUALIFIED");
  const selectedRule = screen?.rules.find((rule) => rule.id === selectedRuleId) ?? null;
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  async function reload(preferredRuleId?: string) {
    const response = await fetch("/api/automations/builder", { cache: "no-store" });
    const body = await response.json() as { result?: BuilderScreen; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar o construtor.");
    setScreen(body.result);
    const id = preferredRuleId ?? selectedRuleId ?? body.result.rules[0]?.id ?? "";
    setSelectedRuleId(id);
    const rule = body.result.rules.find((item) => item.id === id) ?? body.result.rules[0];
    if (rule) setGraph(rule.draftDefinition ?? rule.versions[0]?.graphDefinition ?? acceptanceGraph());
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/automations/builder", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { result?: BuilderScreen; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar o construtor.");
      if (!active) return;
      setScreen(body.result);
      const rule = body.result.rules[0];
      if (rule) { setSelectedRuleId(rule.id); setGraph(rule.draftDefinition ?? rule.versions[0]?.graphDefinition ?? acceptanceGraph()); }
    }).catch((error) => { if (active) setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Não foi possível carregar o construtor." }); });
    return () => { active = false; };
  }, []);

  async function command(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/automations/builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
      const body = await response.json() as { result?: CommandResult; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "A ação não foi concluída.");
      setNotice({ tone: "success", text: success });
      return body.result;
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "A ação não foi concluída." }); return null; }
    finally { setBusy(false); }
  }

  function chooseRule(rule: BuilderRule) {
    setSelectedRuleId(rule.id); setGraph(rule.draftDefinition ?? rule.versions[0]?.graphDefinition ?? acceptanceGraph()); setSelectedNodeId((rule.draftDefinition ?? rule.versions[0]?.graphDefinition)?.nodes[0]?.id ?? ""); setValidation(null); setSimulation(null);
  }

  function patchGraph(patch: Partial<AutomationGraph>) { setGraph((current) => ({ ...current, ...patch })); setValidation(null); }
  function patchNode(patch: Partial<AutomationGraphNode>) { setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } as AutomationGraphNode : node) })); setValidation(null); }
  function patchConfig(key: string, value: unknown) { if (selectedNode) patchNode({ config: { ...selectedNode.config, [key]: value } }); }

  function addNode(type: AutomationGraphNode["type"]) {
    const id = nodeId(); const node: AutomationGraphNode = { id, type, label: nodeLabels[type], config: type === "DELAY" ? { minutes: 30 } : type === "SCHEDULE_WINDOW" ? { startMinute: 480, endMinute: 1200, timeZone: "America/Sao_Paulo" } : type === "ACTION_CREATE_TASK" ? { title: "Nova tarefa" } : type === "CONDITION" ? { mode: "ALL", rules: [{ path: "lead.status", operator: "EQUALS", value: "QUALIFIED" }] } : type === "HUMAN_HANDOFF" ? { reason: "Revisão humana necessária" } : {}, estimatedCostCents: 0 };
    setGraph((current) => {
      const end = current.nodes.find((item) => item.type === "END");
      const incoming = end ? current.edges.find((edge) => edge.target === end.id && edge.branch === "ALWAYS") : undefined;
      const edges = incoming ? [...current.edges.filter((edge) => edge.id !== incoming.id), { ...incoming, target: id }, { id: edgeId(), source: id, target: end!.id, branch: "ALWAYS" as const }] : current.nodes.length ? [...current.edges, { id: edgeId(), source: current.nodes.at(-1)!.id, target: id, branch: "ALWAYS" as const }] : current.edges;
      return { ...current, nodes: [...current.nodes, node], edges };
    }); setSelectedNodeId(id); setValidation(null);
  }

  function patchEdge(id: string, key: "source" | "target" | "branch", value: string) { setGraph((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === id ? { ...edge, [key]: value } as AutomationGraph["edges"][number] : edge) })); setValidation(null); }
  function addEdge() { if (graph.nodes.length < 2) return; setGraph((current) => ({ ...current, edges: [...current.edges, { id: edgeId(), source: selectedNodeId || current.nodes[0]!.id, target: current.nodes.find((node) => node.id !== selectedNodeId)?.id ?? current.nodes[1]!.id, branch: "ALWAYS" }] })); setValidation(null); }

  async function createDraft() { const result = await command("CREATE_DRAFT", { name: graph.name, description: graph.description, graph }, "Rascunho criado."); const id = typeof result?.ruleId === "string" ? result.ruleId : typeof result?.id === "string" ? result.id : undefined; if (result) await reload(id); }
  async function saveDraft() { if (!selectedRule) return; const result = await command("SAVE_DRAFT", { ruleId: selectedRule.id, expectedRevision: selectedRule.draftRevision, graph }, "Rascunho salvo com controle de revisão."); if (result) await reload(selectedRule.id); }
  async function validate() { const result = await command("VALIDATE", { graph }, "Validação concluída."); if (result) setValidation(result as typeof validation); }
  async function simulate() { const result = await command("SIMULATE", { graph, payload: { [runField]: runValue, lead: { status: runValue } } }, "Simulação concluída sem efeitos externos."); if (result) setSimulation(result); }
  async function publish() { if (!selectedRule) return; const result = await command("PUBLISH", { ruleId: selectedRule.id, expectedRevision: selectedRule.draftRevision }, "Versão imutável publicada; execuções antigas preservam o snapshot anterior."); if (result) await reload(selectedRule.id); }
  async function toggleRule() {
    if (!selectedRule) return;
    const status = selectedRule.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/automations/rules/${selectedRule.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reason: "Alteração confirmada no construtor visual." }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível alterar o fluxo.");
      setNotice({ tone: "success", text: `Fluxo ${status === "ACTIVE" ? "ativado" : "pausado"} e auditado.` }); setToggleConfirm(false); await reload(selectedRule.id);
    } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Não foi possível alterar o fluxo." }); }
    finally { setBusy(false); }
  }

  if (!screen) return <div className={styles.builder}><p className={styles.builderNotice} data-tone={notice?.tone ?? "success"}>{notice?.text ?? "Carregando construtor visual…"}</p></div>;
  const palette = screen.catalog.nodeTypes.filter((type) => !screen.catalog.triggerTypes.includes(type) && type !== "END");
  return <div className={styles.builder}>
    <div className={styles.builderTop}><div><h2>Construtor visual</h2><p>Grafo acíclico, ações allowlisted e versões publicadas imutáveis. Webhooks arbitrários não são aceitos.</p></div><div className={styles.builderActions}><Button onClick={() => { setSelectedRuleId(""); setGraph(acceptanceGraph()); setSelectedNodeId("lead"); }} size="sm" variant="secondary">Novo fluxo de aceite</Button>{screen.capabilities.canManage ? <Button disabled={busy} onClick={() => void (selectedRule ? saveDraft() : createDraft())} size="sm">{selectedRule ? "Salvar rascunho" : "Criar rascunho"}</Button> : null}</div></div>
    {notice ? <p className={styles.builderNotice} data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p> : null}
    <div className={styles.resultGrid}><article className={styles.resultCard}><span>Execuções</span><strong>{numericInsight(screen.insights.runsByStatus)}</strong></article><article className={styles.resultCard}><span>Falhas por nó</span><strong>{numericInsight(screen.insights.nodeFailures)}</strong></article><article className={styles.resultCard}><span>Pausas humanas</span><strong>{numericInsight(screen.insights.humanPauses)}</strong></article><article className={styles.resultCard}><span>Replays auditados</span><strong>{numericInsight(screen.insights.replays)}</strong></article><article className={styles.resultCard}><span>Conflitos ativos</span><strong>{screen.conflicts.length}</strong></article><article className={styles.resultCard}><span>Política de runs antigos</span><strong>{screen.catalog.executionPolicy === "PINNED_VERSION" ? "Versão fixada" : screen.catalog.executionPolicy}</strong></article></div>
    <div className={styles.builderLayout}>
      <aside className={styles.builderSidebar}><h3 className={styles.sidebarTitle}><span>Fluxos</span><span>{screen.rules.length}</span></h3><div className={styles.flowList}>{screen.rules.map((rule) => <button aria-current={selectedRuleId === rule.id ? "true" : undefined} key={rule.id} onClick={() => chooseRule(rule)} type="button"><strong>{rule.name}</strong><small>{statusLabel(rule.status)} · rascunho r{rule.draftRevision} · publicada v{rule.version}</small></button>)}</div><h3 className={`${styles.sidebarTitle} mt-5`}>Adicionar etapa</h3><div className={styles.palette}>{palette.map((type) => <button key={type} onClick={() => addNode(type)} type="button"><Icon name={type === "CONDITION" ? "pipeline" : type === "DELAY" || type === "SCHEDULE_WINDOW" ? "relogio" : "automacoes"} size={13} />{nodeLabels[type]}</button>)}</div></aside>
      <main className={styles.builderCanvas}><header className={styles.canvasHeader}><div><input aria-label="Nome do fluxo" className={styles.input} onChange={(event) => patchGraph({ name: event.target.value })} value={graph.name} /><p>{graph.description || "Sem descrição"}</p></div><div className={styles.builderActions}><Button disabled={busy} onClick={() => void validate()} size="sm" variant="secondary">Validar grafo</Button><Button disabled={busy} onClick={() => void simulate()} size="sm" variant="secondary">Simular</Button>{selectedRule && screen.capabilities.canManage ? <Button disabled={busy} onClick={() => void publish()} size="sm">Publicar versão</Button> : null}{selectedRule && ["ACTIVE", "PAUSED"].includes(selectedRule.status) ? <Button disabled={busy} onClick={() => setToggleConfirm(true)} size="sm" variant="secondary">{selectedRule.status === "ACTIVE" ? "Pausar" : "Ativar"}</Button> : null}</div></header><label className={styles.field}>Descrição<input className={styles.input} onChange={(event) => patchGraph({ description: event.target.value })} value={graph.description} /></label>
        <div aria-label="Fluxo visual" className={styles.graph}>{graph.nodes.map((node, index) => <div className="contents" key={node.id}>{index > 0 ? <span aria-hidden="true" className={styles.graphArrow}>→</span> : null}<button aria-current={selectedNodeId === node.id ? "true" : undefined} className={styles.graphNode} onClick={() => setSelectedNodeId(node.id)} type="button"><span>{nodeLabels[node.type]}</span><strong>{node.label}</strong><small>{summarizeConfig(node)}</small></button></div>)}</div>
        <section className={styles.branchPanel}><div className={styles.sectionHead}><h4>Conexões e ramificações</h4><Button onClick={addEdge} size="sm" variant="secondary">Adicionar conexão</Button></div>{graph.edges.map((edge) => <div className={styles.edge} key={edge.id}><select aria-label={`Origem de ${edge.id}`} className={styles.input} onChange={(event) => patchEdge(edge.id, "source", event.target.value)} value={edge.source}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><b>{edge.branch === "TRUE" ? "SIM →" : edge.branch === "FALSE" ? "NÃO →" : "→"}</b><select aria-label={`Destino de ${edge.id}`} className={styles.input} onChange={(event) => patchEdge(edge.id, "target", event.target.value)} value={edge.target}>{graph.nodes.filter((node) => node.id !== edge.source).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><select aria-label={`Ramo de ${edge.id}`} className={styles.input} onChange={(event) => patchEdge(edge.id, "branch", event.target.value)} value={edge.branch}><option value="ALWAYS">Sempre</option><option value="TRUE">Sim</option><option value="FALSE">Não</option></select></div>)}</section>
        {validation ? <section className={styles.branchPanel}><h4>{validation.valid ? "Grafo válido" : "Ajustes necessários"}</h4><p className="text-xs text-muted-foreground">Custo estimado: {Number(validation.estimatedCostCents ?? 0) / 100} reais.</p>{validation.issues?.length ? <ul className={styles.issueList}>{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</section> : null}
        {simulation ? <section className={styles.branchPanel}><h4>Simulação sem efeitos</h4><p className="text-xs text-muted-foreground">Caminho, condições, espera e handoff foram avaliados com dados fictícios. Nenhuma ação de domínio foi executada.</p>{Array.isArray(simulation.steps) ? <ol className={styles.issueList}>{simulation.steps.map((candidate, index) => { const step = candidate as Record<string, unknown>; return <li key={`${String(step.nodeId)}-${index}`}>{index + 1}. {String(step.nodeId)} · {String(step.branch)} · {String(step.outcome)}</li>; })}</ol> : null}<code className="break-all text-[9px]">Efeitos produzidos: {String(simulation.effectsProduced ?? 0)}</code></section> : null}
      </main>
      <aside className={styles.builderSidebar}>{selectedNode ? <NodeInspector node={selectedNode} triggerTypes={screen.catalog.triggerTypes} onNode={patchNode} onConfig={patchConfig} /> : <p className="text-xs text-muted-foreground">Selecione um nó.</p>}<RunControls screen={screen} selectedRule={selectedRule} busy={busy} runLeadId={runLeadId} setRunLeadId={setRunLeadId} runField={runField} setRunField={setRunField} runValue={runValue} setRunValue={setRunValue} command={command} reload={reload} setRollback={setRollback} /></aside>
    </div>
    {selectedRule?.versions.length ? <section><h3 className={styles.sidebarTitle}>Versões imutáveis e rollback</h3><div className={styles.versions}>{[...selectedRule.versions].reverse().map((version) => <article className={styles.version} key={version.id}><div><strong>Versão {version.version}{selectedRule.publishedVersionId === version.id ? " · atual" : ""}</strong><small>{new Date(version.publishedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · hash {version.graphHash.slice(0, 12)}</small></div>{selectedRule.publishedVersionId !== version.id && screen.capabilities.canManage ? <Button onClick={() => setRollback({ versionId: version.id, version: version.version })} size="sm" variant="secondary">Restaurar</Button> : null}</article>)}</div></section> : null}
    {screen.conflicts.length ? <section className={styles.branchPanel}><h4>Conflitos entre fluxos</h4><ul className={styles.issueList}>{screen.conflicts.map((conflict) => <li key={conflict.triggerType}>{conflict.triggerType}: {conflict.ruleNames.join(", ")} respondem ao mesmo gatilho.</li>)}</ul></section> : null}
    {screen.insights.nodes.length ? <section className={styles.branchPanel}><h4>Insights por tipo de nó</h4><div className={styles.nodeInsights}>{screen.insights.nodes.map((item) => <div className={styles.nodeInsight} key={`${item.nodeType}-${item.status}`}><strong>{nodeLabels[item.nodeType as AutomationGraphNode["type"]] ?? item.nodeType}</strong><span>{statusLabel(item.status)}</span><span>{item.count}</span></div>)}</div></section> : null}
    {rollback && selectedRule ? <AccessibleDialog busy={busy} labelledBy="rollback-title" onDismiss={() => setRollback(null)}><h2 id="rollback-title">Restaurar versão {rollback.version}</h2><p className="mt-2 text-xs text-muted-foreground">Uma nova versão imutável será publicada a partir desse grafo. Runs antigos continuam na versão fixada.</p><label className="mt-4 grid gap-1 text-xs font-semibold">Motivo<textarea className={styles.input} minLength={8} onChange={(event) => setRollbackReason(event.target.value)} value={rollbackReason} /></label><div className="mt-4 flex gap-2"><Button disabled={busy || rollbackReason.length < 8} onClick={() => void command("ROLLBACK", { ruleId: selectedRule.id, targetVersionId: rollback.versionId, reason: rollbackReason }, "Rollback publicado como nova versão imutável.").then((result) => { if (result) { setRollback(null); void reload(selectedRule.id); } })}>Confirmar rollback</Button><Button onClick={() => setRollback(null)} variant="secondary">Cancelar</Button></div></AccessibleDialog> : null}
    {toggleConfirm && selectedRule ? <AccessibleDialog busy={busy} labelledBy="toggle-title" onDismiss={() => setToggleConfirm(false)}><h2 id="toggle-title">{selectedRule.status === "ACTIVE" ? "Pausar" : "Ativar"} automação</h2><p className="mt-2 text-xs text-muted-foreground">A alteração vale para próximos eventos. Execuções em espera continuam presas à versão publicada de origem.</p><div className="mt-4 flex gap-2"><Button disabled={busy} onClick={() => void toggleRule()}>Confirmar</Button><Button disabled={busy} onClick={() => setToggleConfirm(false)} variant="secondary">Cancelar</Button></div></AccessibleDialog> : null}
  </div>;
}

function NodeInspector({ node, triggerTypes, onNode, onConfig }: Readonly<{ node: AutomationGraphNode; triggerTypes: readonly AutomationGraphNode["type"][]; onNode: (patch: Partial<AutomationGraphNode>) => void; onConfig: (key: string, value: unknown) => void }>) {
  const rules = Array.isArray(node.config.rules) ? node.config.rules as Array<Record<string, unknown>> : [];
  const configField = (label: string, key: string, placeholder = "") => <label className={styles.field}>{label}<input className={styles.input} onChange={(event) => onConfig(key, event.target.value)} placeholder={placeholder} value={String(node.config[key] ?? "")} /></label>;
  return <div className={styles.inspector}><h3 className={styles.sidebarTitle}>Configurar etapa</h3><label className={styles.field}>Nome<input className={styles.input} onChange={(event) => onNode({ label: event.target.value })} value={node.label} /></label>{triggerTypes.includes(node.type) ? <label className={styles.field}>Gatilho<select className={styles.input} onChange={(event) => onNode({ type: event.target.value as AutomationGraphNode["type"], config: {} })} value={node.type}>{triggerTypes.map((type) => <option key={type} value={type}>{nodeLabels[type]}</option>)}</select></label> : null}
    {node.type === "TRIGGER_FIELD" ? <>{configField("Campo monitorado", "field", "lead.status")}{configField("Novo valor", "value")}</> : null}{node.type === "TRIGGER_CHANNEL" ? configField("Canal", "channel", "WHATSAPP") : null}{node.type === "TRIGGER_CAMPAIGN" ? configField("ID da campanha", "campaignId") : null}{node.type === "TRIGGER_TIME" ? configField("Data/hora ou expressão permitida", "at") : null}
    {node.type === "DELAY" ? <label className={styles.field}>Minutos de espera<input className={styles.input} max={43200} min={1} onChange={(event) => onConfig("minutes", Number(event.target.value))} type="number" value={Number(node.config.minutes ?? 30)} /></label> : null}
    {node.type === "SCHEDULE_WINDOW" ? <><label className={styles.field}>Início em minutos<input className={styles.input} max={1439} min={0} onChange={(event) => onConfig("startMinute", Number(event.target.value))} type="number" value={Number(node.config.startMinute ?? 480)} /></label><label className={styles.field}>Fim em minutos<input className={styles.input} max={1440} min={1} onChange={(event) => onConfig("endMinute", Number(event.target.value))} type="number" value={Number(node.config.endMinute ?? 1200)} /></label>{configField("Fuso horário", "timeZone", "America/Sao_Paulo")}</> : null}
    {node.type === "ACTION_CREATE_TASK" ? configField("Título da tarefa", "title") : null}{node.type === "ACTION_TAG" ? configField("ID da tag", "tagId") : null}{node.type === "ACTION_ASSIGN" ? configField("ID do responsável", "memberId") : null}{node.type === "ACTION_NOTIFICATION" ? configField("Título da notificação", "title") : null}{node.type === "HUMAN_HANDOFF" ? <>{configField("Motivo da pausa", "reason")}{configField("Fila ou responsável", "queueId")}</> : null}
    {node.type === "CONDITION" ? <><label className={styles.field}>Combinação<select className={styles.input} onChange={(event) => onConfig("mode", event.target.value)} value={node.config.mode === "ANY" ? "ANY" : "ALL"}><option value="ALL">Todas (E)</option><option value="ANY">Qualquer (OU)</option></select></label>{rules.map((rule, index) => <div className={styles.conditionRule} key={index}><input aria-label="Campo da condição" className={styles.input} onChange={(event) => onConfig("rules", rules.map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item))} value={String(rule.path ?? "")} /><select aria-label="Operador da condição" className={styles.input} onChange={(event) => onConfig("rules", rules.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value } : item))} value={String(rule.operator ?? "EQUALS")}><option value="EQUALS">Igual</option><option value="NOT_EQUALS">Diferente</option><option value="EXISTS">Existe</option></select><input aria-label="Valor da condição" className={styles.input} disabled={rule.operator === "EXISTS"} onChange={(event) => onConfig("rules", rules.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} value={String(rule.value ?? "")} /></div>)}<Button onClick={() => onConfig("rules", [...rules, { path: "lead.status", operator: "EQUALS", value: "" }])} size="sm" variant="secondary">Adicionar regra</Button></> : null}
    <label className={styles.field}>Custo estimado (centavos)<input className={styles.input} min={0} onChange={(event) => onNode({ estimatedCostCents: Number(event.target.value) })} type="number" value={node.estimatedCostCents} /></label>
  </div>;
}

function RunControls({ screen, selectedRule, busy, runLeadId, setRunLeadId, runField, setRunField, runValue, setRunValue, command, reload, setRollback }: Readonly<{ screen: BuilderScreen; selectedRule: BuilderRule | null; busy: boolean; runLeadId: string; setRunLeadId: (value: string) => void; runField: string; setRunField: (value: string) => void; runValue: string; setRunValue: (value: string) => void; command: (action: string, payload: Record<string, unknown>, success: string) => Promise<CommandResult | null>; reload: (ruleId?: string) => Promise<void>; setRollback: (value: { versionId: string; version: number } | null) => void }>) {
  void setRollback;
  const runs = selectedRule ? screen.runs.filter((run) => run.automationRuleId === selectedRule.id) : [];
  return <div className="mt-6 grid gap-3"><h3 className={styles.sidebarTitle}>Teste e execução</h3><label className={styles.field}>Lead ID opcional<input className={styles.input} onChange={(event) => setRunLeadId(event.target.value)} value={runLeadId} /></label><label className={styles.field}>Campo de entrada<input className={styles.input} onChange={(event) => setRunField(event.target.value)} value={runField} /></label><label className={styles.field}>Valor de entrada<input className={styles.input} onChange={(event) => setRunValue(event.target.value)} value={runValue} /></label>{selectedRule?.publishedVersionId && screen.capabilities.canExecute ? <Button disabled={busy} onClick={() => void command("START_RUN", { ruleId: selectedRule.id, idempotencyKey: `builder:${crypto.randomUUID()}`, leadId: runLeadId || undefined, payload: { [runField]: runValue, lead: { status: runValue } } }, "Execução iniciada na versão publicada.").then((result) => { if (result) void reload(selectedRule.id); })} size="sm">Iniciar run</Button> : null}<div className={styles.runList}>{runs.slice(0, 8).map((run) => { const pausedForHuman = run.status === "PENDING" && run.nodeRuns.at(-1)?.nodeType === "HUMAN_HANDOFF"; return <article className={styles.run} key={run.id}><header><strong>{run.currentNodeId ?? "Fluxo concluído"}</strong><StatusBadge tone={pausedForHuman ? "warning" : statusTone(run.status)}>{pausedForHuman ? "Pausa humana" : statusLabel(run.status)}</StatusBadge></header><p>Versão fixada · {run.executionPolicy}</p><div className={styles.builderActions}>{["PENDING", "RUNNING"].includes(run.status) ? <Button disabled={busy} onClick={() => void command("ADVANCE_RUN", { runId: run.id, resumeHuman: pausedForHuman }, pausedForHuman ? "Handoff confirmado e execução retomada." : "Execução avançada com idempotência.").then((result) => { if (result) void reload(selectedRule?.id); })} size="sm" variant="secondary">{pausedForHuman ? "Confirmar handoff" : "Avançar"}</Button> : null}{run.nodeRuns.filter((node) => node.status === "FAILED").map((node) => <Button disabled={busy} key={node.nodeId} onClick={() => void command("REPLAY_NODE", { runId: run.id, nodeId: node.nodeId, reason: "Replay operacional após revisão da falha." }, "Nó reenfileirado sem duplicar efeito concluído.").then((result) => { if (result) void reload(selectedRule?.id); })} size="sm" variant="secondary">Replay {node.nodeId}</Button>)}</div></article>; })}</div></div>;
}
