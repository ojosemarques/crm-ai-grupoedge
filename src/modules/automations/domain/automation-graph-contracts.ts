import { z } from "zod";

export const AUTOMATION_GRAPH_SCHEMA = "automation.graph/v1" as const;

export const automationNodeTypeSchema = z.enum([
  "TRIGGER_CONTACT", "TRIGGER_OPPORTUNITY", "TRIGGER_FIELD", "TRIGGER_TIME",
  "TRIGGER_CHANNEL", "TRIGGER_CAMPAIGN", "TRIGGER_MANUAL", "CONDITION",
  "DELAY", "SCHEDULE_WINDOW", "ACTION_CREATE_TASK", "ACTION_TRIAGE",
  "ACTION_TAG", "ACTION_ASSIGN", "ACTION_NOTIFICATION", "HUMAN_HANDOFF", "END",
]);

const nodeConfigSchema = z.record(z.string().trim().min(1).max(80), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 10_000, "Configuração do nó excede 10 KB.");

export const automationGraphNodeSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  type: automationNodeTypeSchema,
  label: z.string().trim().min(1).max(120),
  config: nodeConfigSchema.default({}),
  estimatedCostCents: z.number().int().min(0).max(100_000).default(0),
}).strict();

export const automationGraphEdgeSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  branch: z.enum(["ALWAYS", "TRUE", "FALSE"]).default("ALWAYS"),
}).strict();

export const automationGraphSchema = z.object({
  schema: z.literal(AUTOMATION_GRAPH_SCHEMA),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1_000).default(""),
  nodes: z.array(automationGraphNodeSchema).min(2).max(100),
  edges: z.array(automationGraphEdgeSchema).min(1).max(200),
  maxEstimatedCostCents: z.number().int().min(0).max(1_000_000).default(0),
}).strict();

export type AutomationGraph = z.infer<typeof automationGraphSchema>;
export type AutomationGraphNode = z.infer<typeof automationGraphNodeSchema>;

export type GraphValidation = Readonly<{
  valid: boolean;
  issues: readonly string[];
  topologicalOrder: readonly string[];
  estimatedCostCents: number;
}>;

const triggerTypes = new Set<AutomationGraphNode["type"]>([
  "TRIGGER_CONTACT", "TRIGGER_OPPORTUNITY", "TRIGGER_FIELD", "TRIGGER_TIME",
  "TRIGGER_CHANNEL", "TRIGGER_CAMPAIGN", "TRIGGER_MANUAL",
]);

export function validateAutomationGraph(input: unknown): GraphValidation {
  const parsed = automationGraphSchema.safeParse(input);
  if (!parsed.success) {
    return Object.freeze({ valid: false, issues: parsed.error.issues.map((issue) => issue.message), topologicalOrder: [], estimatedCostCents: 0 });
  }
  const graph = parsed.data;
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) issues.push(`Nó duplicado: ${node.id}.`);
    ids.add(node.id);
    if (node.type === "DELAY") {
      const minutes = node.config.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) issues.push(`Atraso inválido no nó ${node.id}.`);
    }
    if (node.type === "SCHEDULE_WINDOW") {
      if (typeof node.config.startMinute !== "number" || typeof node.config.endMinute !== "number") issues.push(`Janela de horário inválida no nó ${node.id}.`);
    }
    if (node.type === "ACTION_CREATE_TASK" && typeof node.config.title !== "string") issues.push(`Título da tarefa ausente no nó ${node.id}.`);
    if (/webhook|https?:\/\//i.test(JSON.stringify(node.config))) issues.push(`Webhook arbitrário proibido no nó ${node.id}.`);
  }
  const triggers = graph.nodes.filter((node) => triggerTypes.has(node.type));
  if (triggers.length !== 1) issues.push("O fluxo exige exatamente um gatilho.");
  const outgoing = new Map<string, typeof graph.edges>();
  const incoming = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) issues.push(`Aresta duplicada: ${edge.id}.`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) { issues.push(`Aresta ${edge.id} referencia nó inexistente.`); continue; }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const originalIncoming = new Map(incoming);
  for (const node of graph.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (node.type === "CONDITION") {
      if (edges.filter((edge) => edge.branch === "TRUE").length !== 1 || edges.filter((edge) => edge.branch === "FALSE").length !== 1) issues.push(`Condição ${node.id} exige ramos TRUE e FALSE.`);
    } else {
      if (edges.some((edge) => edge.branch !== "ALWAYS")) issues.push(`Ramificação só é permitida após condição (${node.id}).`);
      if (edges.length > 1) issues.push(`Nó ${node.id} permite no máximo uma saída.`);
    }
    if (node.type === "END" && edges.length > 0) {
      issues.push(`Nó final ${node.id} não pode ter saída.`);
    }
  }
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const next = (incoming.get(edge.target) ?? 1) - 1;
      incoming.set(edge.target, next);
      if (next === 0) { queue.push(edge.target); queue.sort(); }
    }
  }
  if (order.length !== graph.nodes.length) issues.push("O fluxo contém ciclo.");
  if (triggers[0]) {
    const reachable = new Set<string>(); const pending = [triggers[0].id];
    while (pending.length) { const id = pending.pop()!; if (reachable.has(id)) continue; reachable.add(id); for (const edge of outgoing.get(id) ?? []) pending.push(edge.target); }
    for (const node of graph.nodes) if (!reachable.has(node.id)) issues.push(`Nó inalcançável: ${node.id}.`);
    if ((originalIncoming.get(triggers[0].id) ?? 0) > 0) issues.push("O gatilho não pode ter entrada.");
  }
  const estimatedCostCents = graph.nodes.reduce((sum, node) => sum + node.estimatedCostCents, 0);
  if (estimatedCostCents > graph.maxEstimatedCostCents) issues.push("O custo estimado excede o limite do fluxo.");
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues), topologicalOrder: Object.freeze(order), estimatedCostCents });
}

export function nextNodeId(graph: AutomationGraph, nodeId: string, branch: "TRUE" | "FALSE" | "ALWAYS" = "ALWAYS"): string | null {
  const edges = graph.edges.filter((edge) => edge.source === nodeId);
  return edges.find((edge) => edge.branch === branch)?.target ?? edges.find((edge) => edge.branch === "ALWAYS")?.target ?? null;
}

export function evaluateGraphCondition(config: Readonly<Record<string, unknown>>, payload: Readonly<Record<string, unknown>>): boolean {
  const mode = config.mode === "ANY" ? "ANY" : "ALL";
  const raw = Array.isArray(config.rules) ? config.rules : [];
  const values = raw.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const rule = candidate as Record<string, unknown>;
    const actual = typeof rule.path === "string" ? rule.path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, payload) : undefined;
    return rule.operator === "EXISTS" ? actual !== undefined : rule.operator === "NOT_EQUALS" ? actual !== rule.value : actual === rule.value;
  });
  return mode === "ANY" ? values.some(Boolean) : values.every(Boolean);
}
