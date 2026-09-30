import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { startGovernedConversationInTransaction } from "@/modules/ai-agents/application/governed-agent-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  automationGraphSchema,
  evaluateGraphCondition,
  nextNodeId,
  readGraphPayloadPath,
  validateAutomationGraph,
  type AutomationGraph,
} from "@/modules/automations/domain/automation-graph-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, permission: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, permission: PermissionKey, resource: ResourceScope): Promise<void>;
}>;

type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

export const automationBuilderCommandSchema = z.object({
  action: z.enum(["CREATE_DRAFT", "SAVE_DRAFT", "VALIDATE", "SIMULATE", "PUBLISH", "ROLLBACK", "START_RUN", "ADVANCE_RUN", "REPLAY_NODE"]),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

const uuid = z.string().uuid();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const graphHash = (graph: AutomationGraph) => createHash("sha256").update(JSON.stringify(graph)).digest("hex");

const catalog = Object.freeze({
  schema: "automation.graph/v1",
  executionPolicy: "CONTINUE_SNAPSHOT",
  triggers: [
    ["TRIGGER_CONTACT", "Contato/lead"], ["TRIGGER_OPPORTUNITY", "Negócio"], ["TRIGGER_FIELD", "Campo alterado"],
    ["TRIGGER_TIME", "Tempo/data"], ["TRIGGER_CHANNEL", "Canal"], ["TRIGGER_CAMPAIGN", "Campanha"], ["TRIGGER_MANUAL", "Manual"],
  ].map(([type, label]) => ({ type, label })),
  controls: [
    { type: "CONDITION", label: "Condição E/OU", branches: ["TRUE", "FALSE"] },
    { type: "AGENT_ROUTE", label: "Ramificar intenção/sem resposta", branches: ["INTENT", "NO_RESPONSE"] },
    { type: "DELAY", label: "Espera", limits: { minMinutes: 1, maxMinutes: 43_200 } },
    { type: "SCHEDULE_WINDOW", label: "Janela de horário" },
  ],
  actions: [
    ["ACTION_TRIAGE", "Triagem"], ["ACTION_CREATE_TASK", "Criar tarefa"], ["ACTION_TAG", "Aplicar tag"],
    ["ACTION_ASSIGN", "Atribuir responsável"], ["ACTION_NOTIFICATION", "Notificar"],
    ["AGENT_START_CONVERSATION", "Iniciar conversa com agente"], ["AGENT_COLLECT_FIELDS", "Coletar campos propostos"],
    ["HUMAN_HANDOFF", "Handoff humano"], ["END", "Encerrar"],
  ].map(([type, label]) => ({ type, label })),
  forbidden: ["ciclo", "webhook arbitrário", "URL arbitrária"],
  nodeTypes: ["TRIGGER_CONTACT", "TRIGGER_OPPORTUNITY", "TRIGGER_FIELD", "TRIGGER_TIME", "TRIGGER_CHANNEL", "TRIGGER_CAMPAIGN", "TRIGGER_MANUAL", "CONDITION", "DELAY", "SCHEDULE_WINDOW", "ACTION_CREATE_TASK", "ACTION_TRIAGE", "ACTION_TAG", "ACTION_ASSIGN", "ACTION_NOTIFICATION", "AGENT_START_CONVERSATION", "AGENT_COLLECT_FIELDS", "AGENT_ROUTE", "HUMAN_HANDOFF", "END"],
  triggerTypes: ["TRIGGER_CONTACT", "TRIGGER_OPPORTUNITY", "TRIGGER_FIELD", "TRIGGER_TIME", "TRIGGER_CHANNEL", "TRIGGER_CAMPAIGN", "TRIGGER_MANUAL"],
  actionTypes: ["ACTION_TRIAGE", "ACTION_CREATE_TASK", "ACTION_TAG", "ACTION_ASSIGN", "ACTION_NOTIFICATION", "AGENT_START_CONVERSATION", "AGENT_COLLECT_FIELDS", "HUMAN_HANDOFF", "END"],
});

export const acceptanceGraph: AutomationGraph = {
  schema: "automation.graph/v1",
  name: "Lead → triagem → tarefa → espera → condição → handoff",
  description: "Fluxo visual padrão de qualificação com continuidade por versão.",
  maxEstimatedCostCents: 0,
  nodes: [
    { id: "lead", type: "TRIGGER_CONTACT", label: "Lead recebido", config: {}, estimatedCostCents: 0 },
    { id: "triage", type: "ACTION_TRIAGE", label: "Triagem", config: { priority: "MEDIUM" }, estimatedCostCents: 0 },
    { id: "task", type: "ACTION_CREATE_TASK", label: "Criar tarefa", config: { title: "Realizar triagem do lead", dueInMinutes: 30 }, estimatedCostCents: 0 },
    { id: "wait", type: "DELAY", label: "Aguardar", config: { minutes: 60 }, estimatedCostCents: 0 },
    { id: "condition", type: "CONDITION", label: "Lead qualificado?", config: { mode: "ALL", rules: [{ path: "qualified", operator: "EQUALS", value: true }] }, estimatedCostCents: 0 },
    { id: "handoff", type: "HUMAN_HANDOFF", label: "Handoff humano", config: { reason: "Lead qualificado" }, estimatedCostCents: 0 },
    { id: "end", type: "END", label: "Encerrar", config: {}, estimatedCostCents: 0 },
  ],
  edges: [
    { id: "e1", source: "lead", target: "triage", branch: "ALWAYS" },
    { id: "e2", source: "triage", target: "task", branch: "ALWAYS" },
    { id: "e3", source: "task", target: "wait", branch: "ALWAYS" },
    { id: "e4", source: "wait", target: "condition", branch: "ALWAYS" },
    { id: "e5", source: "condition", target: "handoff", branch: "TRUE" },
    { id: "e6", source: "condition", target: "end", branch: "FALSE" },
    { id: "e7", source: "handoff", target: "end", branch: "ALWAYS" },
  ],
};

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function parseGraph(value: unknown): AutomationGraph {
  const parsed = automationGraphSchema.safeParse(value);
  if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join(" "));
  return parsed.data;
}

function resource(workspaceId: string, id?: string): ResourceScope {
  return { workspaceId, resourceType: "AutomationRule", ...(id ? { resourceId: id } : {}) };
}

const sensitiveAgentFields = new Set(["price", "preco", "preço", "proposal", "proposta", "stage", "etapa"]);

export function selectAutomationNodeBranch(node: AutomationGraph["nodes"][number], input: Record<string, unknown>) {
  if (node.type !== "AGENT_ROUTE") return null;
  const noResponsePath = typeof node.config.noResponsePath === "string" ? node.config.noResponsePath : "agentTurn.noResponse";
  return readGraphPayloadPath(input, noResponsePath) === true ? "NO_RESPONSE" as const : "INTENT" as const;
}

export function buildGovernedAgentNodeSnapshot(node: AutomationGraph["nodes"][number], input: Record<string, unknown>, effectKey: string): Record<string, unknown> | null {
  if (node.type === "AGENT_START_CONVERSATION") {
    const conversationIdPath = typeof node.config.conversationIdPath === "string" ? node.config.conversationIdPath : "conversationId";
    const messagePath = typeof node.config.messagePath === "string" ? node.config.messagePath : "message";
    const conversationId = readGraphPayloadPath(input, conversationIdPath);
    const message = readGraphPayloadPath(input, messagePath);
    return {
      kind: "AGENT_CONVERSATION_START_PROPOSED",
      status: "PENDING_AGENT_RUNTIME",
      action: "START_CONVERSATION",
      agentId: node.config.agentId,
      conversationId: typeof conversationId === "string" ? conversationId : null,
      idempotencyKey: effectKey,
      messagePresent: typeof message === "string" && message.trim().length > 0,
      externalEgress: false,
    };
  }
  if (node.type === "AGENT_COLLECT_FIELDS") {
    const proposedSource = record(readGraphPayloadPath(input, "agentTurn.proposedFields") ?? input.proposedFields);
    const configuredFields = Array.isArray(node.config.fields) ? node.config.fields.filter((field): field is string => typeof field === "string") : [];
    const proposedFields = Object.fromEntries(configuredFields.map((field) => [field, readGraphPayloadPath(proposedSource, field)]).filter((entry) => entry[1] !== undefined));
    const sensitiveFields = configuredFields.filter((field) => sensitiveAgentFields.has(field.split(".").at(-1)!.toLocaleLowerCase("pt-BR")));
    return {
      kind: "AGENT_FIELDS_PROPOSED",
      status: sensitiveFields.length > 0 ? "PENDING_HUMAN_APPROVAL" : "PROPOSED",
      agentId: node.config.agentId,
      proposedFields,
      sensitiveFields,
      authoritativeMutation: false,
    };
  }
  if (node.type === "AGENT_ROUTE") {
    const intentPath = typeof node.config.intentPath === "string" ? node.config.intentPath : "agentTurn.intent";
    const intent = readGraphPayloadPath(input, intentPath);
    return {
      kind: "AGENT_ROUTE_SELECTED",
      agentId: node.config.agentId,
      route: selectAutomationNodeBranch(node, input),
      intent: typeof intent === "string" ? intent : null,
      authoritativeMutation: false,
    };
  }
  return null;
}

function simulate(graph: AutomationGraph, input: Record<string, unknown>) {
  const validation = validateAutomationGraph(graph);
  if (!validation.valid) return { validation, steps: [], effectsProduced: 0 };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  let current = graph.nodes.find((node) => node.type.startsWith("TRIGGER_"))?.id ?? null;
  const steps: Array<{ nodeId: string; type: string; branch: string; outcome: string }> = [];
  while (current && steps.length <= graph.nodes.length) {
    const node = byId.get(current)!;
    const condition = node.type === "CONDITION" ? evaluateGraphCondition(node.config, input) : null;
    const branch = selectAutomationNodeBranch(node, input) ?? (condition === null ? "ALWAYS" : condition ? "TRUE" : "FALSE");
    const outcome = node.type === "HUMAN_HANDOFF" ? "PAUSA_HUMANA" : node.type.startsWith("AGENT_") ? "PROPOSTA_SEGURA" : "SIMULATED";
    steps.push({ nodeId: node.id, type: node.type, branch, outcome });
    current = nextNodeId(graph, node.id, branch);
  }
  return { validation, steps, effectsProduced: 0 };
}

export function createAutomationBuilderService(options: Options) {
  async function screen(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_READ, resource(context.workspaceId));
    const [manage, execute, rules, runs, nodeGroups] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.AUTOMATIONS_MANAGE, resource(context.workspaceId)),
      options.authorization.authorize(context, PermissionKeys.AUTOMATIONS_EXECUTE, resource(context.workspaceId)),
      options.database.automationRule.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { id: true, key: true, name: true, description: true, status: true, isPredefined: true, version: true, draftRevision: true, draftDefinition: true, publishedVersionId: true, updatedAt: true,
          versions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, graphDefinition: true, graphHash: true, rollbackOfVersionId: true, publishedAt: true } } },
      }),
      options.database.automationRun.findMany({
        where: { workspaceId: context.workspaceId, graphSnapshot: { not: Prisma.JsonNull } }, orderBy: [{ triggeredAt: "desc" }], take: 50,
        select: { id: true, automationRuleId: true, automationRuleVersionId: true, status: true, currentNodeId: true, executionPolicy: true, triggeredAt: true, finishedAt: true, errorCode: true, errorMessage: true,
          nodeRuns: { orderBy: [{ startedAt: "asc" }, { visit: "asc" }], select: { id: true, nodeId: true, nodeType: true, visit: true, status: true, errorCode: true, errorMessage: true, startedAt: true, finishedAt: true, outputSnapshot: true } } },
      }),
      options.database.automationNodeRun.groupBy({ by: ["nodeType", "status"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
    ]);
    const activeTriggers = new Map<string, string[]>();
    for (const rule of rules) {
      if (rule.status !== "ACTIVE" || !rule.versions[0]) continue;
      const parsed = automationGraphSchema.safeParse(rule.versions[0].graphDefinition);
      const trigger = parsed.success ? parsed.data.nodes.find((node) => node.type.startsWith("TRIGGER_"))?.type : undefined;
      if (trigger) activeTriggers.set(trigger, [...(activeTriggers.get(trigger) ?? []), rule.name]);
    }
    return {
      generatedAt: options.now().toISOString(), catalog, capabilities: { canManage: manage.allowed, canExecute: execute.allowed },
      rules: rules.map((rule) => ({ ...rule, updatedAt: rule.updatedAt.toISOString(), versions: rule.versions.map((version) => ({ ...version, publishedAt: version.publishedAt.toISOString() })) })),
      runs: runs.map((run) => ({ ...run, triggeredAt: run.triggeredAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, nodeRuns: run.nodeRuns.map((node) => ({ ...node, startedAt: node.startedAt.toISOString(), finishedAt: node.finishedAt?.toISOString() ?? null })) })),
      insights: {
        runsByStatus: Object.fromEntries(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].map((status) => [status, runs.filter((run) => run.status === status).length])),
        nodeFailures: nodeGroups.filter((group) => group.status === "FAILED").reduce((sum, group) => sum + group._count._all, 0),
        humanPauses: nodeGroups.filter((group) => group.nodeType === "HUMAN_HANDOFF").reduce((sum, group) => sum + group._count._all, 0),
        replays: runs.flatMap((run) => run.nodeRuns).filter((node) => node.visit > 1).length,
        nodes: nodeGroups.map((group) => ({ nodeType: group.nodeType, status: group.status, count: group._count._all })),
      },
      conflicts: [...activeTriggers].filter(([, names]) => names.length > 1).map(([triggerType, ruleNames]) => ({ triggerType, ruleNames, severity: "WARNING" })),
      waitingPolicy: "CONTINUE_SNAPSHOT",
    };
  }

  async function audit(tx: Prisma.TransactionClient, context: AuthenticatedContext, action: string, entityId: string, changes: unknown) {
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action, entityType: "AutomationRule", entityId, changes: json(changes) } });
  }

  async function createDraft(context: AuthenticatedContext, payload: Record<string, unknown>) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_MANAGE, resource(context.workspaceId));
    const graph = parseGraph(payload.graph ?? acceptanceGraph);
    const validation = validateAutomationGraph(graph);
    const id = randomUUID();
    const rule = await options.database.$transaction(async (tx) => {
      const created = await tx.automationRule.create({ data: {
        id, workspaceId: context.workspaceId, key: `visual-${id}`, name: graph.name, description: graph.description || "Automação visual",
        status: "DRAFT", isPredefined: false, triggerType: "MANUAL", actionType: "CREATE_TASK", conditions: { all: [] }, actionConfig: {},
        draftDefinition: json(graph), createdByActorId: context.actorId, updatedByActorId: context.actorId,
      } });
      await audit(tx, context, "automation_builder.draft_created", created.id, { validation });
      return created;
    });
    return { ruleId: rule.id, draftRevision: rule.draftRevision, graph, validation };
  }

  async function saveDraft(context: AuthenticatedContext, payload: Record<string, unknown>) {
    const ruleId = uuid.parse(payload.ruleId);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_MANAGE, resource(context.workspaceId, ruleId));
    const graph = parseGraph(payload.graph);
    const expectedRevision = z.number().int().positive().parse(payload.expectedRevision);
    const updated = await options.database.$transaction(async (tx) => {
      const result = await tx.automationRule.updateMany({ where: { id: ruleId, workspaceId: context.workspaceId, deletedAt: null, draftRevision: expectedRevision }, data: { name: graph.name, description: graph.description, draftDefinition: json(graph), draftRevision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (result.count !== 1) fail("O rascunho foi alterado por outra sessão.", "DRAFT_REVISION_CONFLICT", 409);
      const saved = await tx.automationRule.findFirstOrThrow({ where: { id: ruleId, workspaceId: context.workspaceId }, select: { id: true, draftRevision: true, draftDefinition: true } });
      await audit(tx, context, "automation_builder.draft_saved", ruleId, { draftRevision: saved.draftRevision });
      return saved;
    });
    return { ...updated, validation: validateAutomationGraph(graph) };
  }

  async function publish(context: AuthenticatedContext, payload: Record<string, unknown>, rollbackOfVersionId?: string) {
    const ruleId = uuid.parse(payload.ruleId);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_MANAGE, resource(context.workspaceId, ruleId));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-publish:${context.workspaceId}:${ruleId}`}, 0))`;
      const rule = await tx.automationRule.findFirst({ where: { id: ruleId, workspaceId: context.workspaceId, deletedAt: null }, select: { draftDefinition: true, draftRevision: true } });
      if (!rule) fail("Automação não encontrada.", "NOT_FOUND", 404);
      if (payload.expectedRevision !== undefined && z.number().int().positive().parse(payload.expectedRevision) !== rule.draftRevision) {
        fail("O rascunho foi alterado por outra sessão.", "DRAFT_REVISION_CONFLICT", 409);
      }
      const graph = parseGraph(payload.graph ?? rule.draftDefinition);
      const validation = validateAutomationGraph(graph);
      if (!validation.valid) fail(validation.issues.join(" "), "INVALID_AUTOMATION_GRAPH", 409);
      const aggregate = await tx.automationRuleVersion.aggregate({ where: { workspaceId: context.workspaceId, automationRuleId: ruleId }, _max: { version: true } });
      const version = (aggregate._max.version ?? 0) + 1;
      const created = await tx.automationRuleVersion.create({ data: { workspaceId: context.workspaceId, automationRuleId: ruleId, version, graphDefinition: json(graph), graphHash: graphHash(graph), validationSnapshot: json(validation), rollbackOfVersionId: rollbackOfVersionId ?? null, publishedByActorId: context.actorId, publishedAt: options.now() } });
      await tx.automationRule.update({ where: { id: ruleId }, data: { status: "ACTIVE", version, publishedVersionId: created.id, draftDefinition: json(graph), name: graph.name, description: graph.description, updatedByActorId: context.actorId } });
      await audit(tx, context, rollbackOfVersionId ? "automation_builder.rollback_published" : "automation_builder.version_published", ruleId, { version, versionId: created.id, graphHash: created.graphHash, waitingPolicy: "CONTINUE_SNAPSHOT" });
      return { ruleId, versionId: created.id, version, graphHash: created.graphHash, validation, waitingPolicy: "CONTINUE_SNAPSHOT" };
    });
  }

  async function rollback(context: AuthenticatedContext, payload: Record<string, unknown>) {
    const ruleId = uuid.parse(payload.ruleId); const versionId = uuid.parse(payload.targetVersionId ?? payload.versionId);
    const version = await options.database.automationRuleVersion.findFirst({ where: { id: versionId, workspaceId: context.workspaceId, automationRuleId: ruleId }, select: { graphDefinition: true } });
    if (!version) fail("Versão não encontrada.", "NOT_FOUND", 404);
    return publish(context, { ruleId, graph: version.graphDefinition }, versionId);
  }

  async function startRun(context: AuthenticatedContext, payload: Record<string, unknown>) {
    const ruleId = uuid.parse(payload.ruleId);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_EXECUTE, resource(context.workspaceId, ruleId));
    const input = { ...record(payload.payload ?? payload.input), ...(payload.leadId ? { leadId: payload.leadId } : {}), ...(payload.opportunityId ? { opportunityId: payload.opportunityId } : {}) };
    const idempotencyKey = z.string().trim().min(8).max(180).parse(payload.idempotencyKey ?? randomUUID());
    const existing = await options.database.automationRun.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey }, select: { id: true, job: { select: { id: true } } } });
    if (existing?.job) return { runId: existing.id, jobId: existing.job.id, duplicated: true };
    const rule = await options.database.automationRule.findFirst({ where: { id: ruleId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, include: { publishedVersion: true } });
    if (!rule?.publishedVersion) fail("Publique uma versão ativa antes de executar.", "AUTOMATION_VERSION_REQUIRED", 409);
    const graph = parseGraph(rule.publishedVersion.graphDefinition); const trigger = graph.nodes.find((node) => node.type.startsWith("TRIGGER_"))!;
    const result = await options.database.$transaction(async (tx) => {
      const run = await tx.automationRun.create({ data: { workspaceId: context.workspaceId, automationRuleId: rule.id, automationRuleVersionId: rule.publishedVersion!.id,
        leadId: typeof input.leadId === "string" && uuid.safeParse(input.leadId).success ? input.leadId : null, actorId: context.actorId, status: "PENDING", idempotencyKey,
        ruleVersion: rule.publishedVersion!.version, triggerType: "MANUAL", actionType: "CREATE_TASK", conditionsSnapshot: { all: [] }, actionConfigSnapshot: {}, graphSnapshot: json(graph), currentNodeId: trigger.id,
        executionPolicy: "CONTINUE_SNAPSHOT", inputPayload: json({ source: "BUILDER", payload: input }), triggeredAt: options.now() } });
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "AUTOMATION", status: "RUNNING", automationRunId: run.id, idempotencyKey, priority: 0,
        runAt: options.now(), maxAttempts: 5, lockedAt: options.now(), lockedBy: "automation-builder", lockExpiresAt: new Date(options.now().getTime() + 100 * 365 * 24 * 60 * 60 * 1_000),
        payload: json({ graph: true, input }), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await audit(tx, context, "automation_builder.run_started", ruleId, { runId: run.id, versionId: rule.publishedVersion!.id });
      return { runId: run.id, jobId: job.id };
    });
    return { ...result, duplicated: false };
  }

  async function advanceRun(context: AuthenticatedContext, payload: Record<string, unknown>) {
    const runId = uuid.parse(payload.runId);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_EXECUTE, { workspaceId: context.workspaceId, resourceType: "AutomationRun", resourceId: runId });
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-run:${context.workspaceId}:${runId}`}, 0))`;
      const run = await tx.automationRun.findFirst({ where: { id: runId, workspaceId: context.workspaceId }, include: { job: true } });
      if (!run?.graphSnapshot || !run.currentNodeId || !run.job) fail("Execução visual não encontrada ou já concluída.", "NOT_FOUND", 404);
      const graph = parseGraph(run.graphSnapshot); const node = graph.nodes.find((candidate) => candidate.id === run.currentNodeId);
      if (!node) fail("Nó atual ausente no snapshot.", "INVALID_AUTOMATION_GRAPH", 409);
      const last = await tx.automationNodeRun.findFirst({ where: { workspaceId: context.workspaceId, automationRunId: runId, nodeId: node.id }, orderBy: { visit: "desc" }, select: { visit: true, status: true, outputSnapshot: true } });
      if (last?.status === "SUCCEEDED" && payload.expectedNodeId === node.id) return { runId, nodeId: node.id, duplicated: true, output: last.outputSnapshot };
      const visit = (last?.visit ?? 0) + 1; const key = `${run.id}:node:${node.id}:visit:${visit}`; const input = record(record(run.inputPayload).payload);
      const condition = node.type === "CONDITION" ? evaluateGraphCondition(node.config, input) : null;
      const branch = selectAutomationNodeBranch(node, input) ?? (condition === null ? "ALWAYS" : condition ? "TRUE" : "FALSE"); const next = nextNodeId(graph, node.id, branch);
      let domainEffect: Record<string, unknown> | null = null;
      domainEffect = buildGovernedAgentNodeSnapshot(node, input, `${run.id}:node:${node.id}`);
      if (node.type === "AGENT_START_CONVERSATION") {
        await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId });
        const conversationIdPath = typeof node.config.conversationIdPath === "string" ? node.config.conversationIdPath : "conversationId";
        const messagePath = typeof node.config.messagePath === "string" ? node.config.messagePath : "message";
        const conversationId = readGraphPayloadPath(input, conversationIdPath);
        const message = readGraphPayloadPath(input, messagePath);
        if (typeof conversationId !== "string" || !uuid.safeParse(conversationId).success || typeof message !== "string" || !message.trim()) {
          fail("O nó de agente exige conversationId e mensagem válidos no payload.", "AGENT_RUNTIME_INPUT_REQUIRED", 422);
        }
        const turn = await startGovernedConversationInTransaction(tx, context, {
          agentId: String(node.config.agentId),
          conversationId,
          idempotencyKey: `${run.id}:node:${node.id}`,
          message,
        }, options.now);
        domainEffect = {
          kind: "AGENT_CONVERSATION_STARTED",
          turnId: turn.turnId,
          status: turn.status,
          confidenceBps: turn.confidenceBps,
          sources: turn.sources,
          summary: turn.summary,
          proposedFields: turn.proposedFields,
          response: turn.response,
          duplicated: turn.duplicated,
          externalEgress: false,
          authoritativeMutation: false,
        };
      }
      if (run.leadId && node.type === "ACTION_TRIAGE") {
        const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(node.config.priority)) ? String(node.config.priority) as "LOW" | "MEDIUM" | "HIGH" | "URGENT" : "MEDIUM";
        await tx.lead.updateMany({ where: { id: run.leadId, workspaceId: context.workspaceId, deletedAt: null }, data: { priority, updatedByActorId: context.actorId } });
        domainEffect = { kind: "LEAD_TRIAGED", leadId: run.leadId, priority };
      }
      if (run.leadId && node.type === "ACTION_CREATE_TASK") {
        const title = typeof node.config.title === "string" ? node.config.title : "Tarefa da automação";
        const existingTask = await tx.task.findFirst({ where: { workspaceId: context.workspaceId, automationRunId: run.id, title, deletedAt: null }, select: { id: true } });
        const task = existingTask ?? await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: run.leadId, automationRunId: run.id, assigneeMemberId: context.memberId, title,
          dueAt: new Date(options.now().getTime() + (typeof node.config.dueInMinutes === "number" ? node.config.dueInMinutes : 30) * 60_000), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        domainEffect = { kind: "TASK_CREATED", taskId: task.id, duplicated: Boolean(existingTask) };
      }
      if (run.leadId && node.type === "ACTION_TAG") {
        const tagId = uuid.parse(node.config.tagId);
        const tag = await tx.tag.findFirst({ where: { id: tagId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } });
        if (!tag) fail("Tag da automação não encontrada.", "AUTOMATION_TAG_NOT_FOUND", 409);
        const existingTag = await tx.leadTag.findFirst({ where: { workspaceId: context.workspaceId, leadId: run.leadId, tagId, removedAt: null }, select: { id: true } });
        const assignment = existingTag ?? await tx.leadTag.create({ data: { workspaceId: context.workspaceId, leadId: run.leadId, tagId, createdByActorId: context.actorId } });
        domainEffect = { kind: "TAG_APPLIED", leadTagId: assignment.id, duplicated: Boolean(existingTag) };
      }
      if (run.leadId && node.type === "ACTION_ASSIGN") {
        const memberId = uuid.parse(node.config.memberId);
        const member = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
        if (!member) fail("Responsável da automação não está ativo.", "AUTOMATION_ASSIGNEE_NOT_FOUND", 409);
        await tx.lead.updateMany({ where: { id: run.leadId, workspaceId: context.workspaceId, deletedAt: null }, data: { ownerMemberId: memberId, updatedByActorId: context.actorId } });
        domainEffect = { kind: "LEAD_ASSIGNED", memberId };
      }
      if (node.type === "ACTION_NOTIFICATION") {
        const title = typeof node.config.title === "string" ? node.config.title : "Resultado da automação";
        const existingNotification = await tx.notification.findFirst({ where: { workspaceId: context.workspaceId, automationRunId: run.id, recipientMemberId: context.memberId, title, deletedAt: null }, select: { id: true } });
        const notification = existingNotification ?? await tx.notification.create({ data: { workspaceId: context.workspaceId, recipientMemberId: context.memberId, leadId: run.leadId,
          automationRunId: run.id, type: "AUTOMATION_RESULT", title, body: typeof node.config.body === "string" ? node.config.body : "Uma etapa do fluxo visual foi concluída.", createdByActorId: context.actorId } });
        domainEffect = { kind: "NOTIFICATION_CREATED", notificationId: notification.id, duplicated: Boolean(existingNotification) };
      }
      if (run.leadId && node.type === "HUMAN_HANDOFF") {
        const existingHandoff = await tx.customerHandoff.findFirst({ where: { workspaceId: context.workspaceId, automationRunId: run.id, leadId: run.leadId }, select: { id: true } });
        const queueId = typeof node.config.queueId === "string" && uuid.safeParse(node.config.queueId).success ? node.config.queueId : null;
        const handoff = existingHandoff ?? await tx.customerHandoff.create({ data: { workspaceId: context.workspaceId, leadId: run.leadId, automationRunId: run.id,
          fromMemberId: context.memberId, toQueueId: queueId, toMemberId: queueId ? null : context.memberId, reason: typeof node.config.reason === "string" ? node.config.reason : "Revisão humana solicitada pela automação",
          snapshot: json({ graphVersionId: run.automationRuleVersionId, nodeId: node.id }), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        await tx.lead.updateMany({ where: { id: run.leadId, workspaceId: context.workspaceId }, data: { awaitingHumanResponse: true, updatedByActorId: context.actorId } });
        domainEffect = { kind: "HUMAN_HANDOFF_REQUESTED", handoffId: handoff.id, duplicated: Boolean(existingHandoff) };
      }
      const output = { nodeId: node.id, type: node.type, branch, nextNodeId: next, humanPause: node.type === "HUMAN_HANDOFF", effectKey: `${run.id}:node:${node.id}`, domainEffect };
      await tx.automationNodeRun.create({ data: { workspaceId: context.workspaceId, automationRunId: runId, nodeId: node.id, nodeType: node.type, visit, status: "SUCCEEDED", idempotencyKey: key, inputSnapshot: json(input), outputSnapshot: json(output), startedAt: options.now(), finishedAt: options.now() } });
      const finished = node.type === "END" || !next; const delayed = node.type === "DELAY"; const humanPause = node.type === "HUMAN_HANDOFF";
      const delayMinutes = delayed && typeof node.config.minutes === "number" ? node.config.minutes : 0;
      const runAt = new Date(options.now().getTime() + delayMinutes * 60_000);
      await tx.automationRun.update({ where: { id: run.id }, data: { status: finished ? "SUCCEEDED" : "PENDING", currentNodeId: finished ? null : next, startedAt: run.startedAt ?? options.now(), finishedAt: finished ? options.now() : null, outputPayload: json(output) } });
      await tx.job.update({ where: { id: run.job.id }, data: { status: finished || humanPause ? "SUCCEEDED" : "RUNNING", runAt, finishedAt: finished || humanPause ? options.now() : null,
        lockedAt: finished || humanPause ? null : run.job.lockedAt, lockedBy: finished || humanPause ? null : run.job.lockedBy, lockExpiresAt: finished || humanPause ? null : run.job.lockExpiresAt,
        result: json(output), updatedByActorId: context.actorId } });
      await audit(tx, context, humanPause ? "automation_builder.human_pause" : "automation_builder.node_advanced", run.automationRuleId, { runId, ...output });
      return { runId, visit, duplicated: false, finished, delayedUntil: delayed ? runAt.toISOString() : null, ...output };
    });
  }

  async function replayNode(context: AuthenticatedContext, payload: Record<string, unknown>) {
    const runId = uuid.parse(payload.runId); const nodeId = z.string().min(1).max(80).parse(payload.nodeId);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_EXECUTE, { workspaceId: context.workspaceId, resourceType: "AutomationRun", resourceId: runId });
    const failed = await options.database.automationNodeRun.findFirst({ where: { workspaceId: context.workspaceId, automationRunId: runId, nodeId, status: "FAILED" }, orderBy: { visit: "desc" } });
    if (!failed) fail("Somente nó com falha pode ser reenfileirado.", "NODE_NOT_REPLAYABLE", 409);
    await options.database.$transaction(async (tx) => {
      await tx.automationRun.update({ where: { id: runId }, data: { status: "PENDING", currentNodeId: nodeId, errorCode: null, errorMessage: null, finishedAt: null } });
      await tx.job.updateMany({ where: { workspaceId: context.workspaceId, automationRunId: runId }, data: { status: "PENDING", runAt: options.now(), errorCode: null, lastError: null, finishedAt: null, updatedByActorId: context.actorId } });
      await audit(tx, context, "automation_builder.node_replay_requested", runId, { nodeId, previousVisit: failed.visit });
    });
    return { runId, nodeId, replayQueued: true, effectIdempotencyKey: `${runId}:node:${nodeId}` };
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const parsed = automationBuilderCommandSchema.parse(raw); const payload = parsed.payload;
    if (parsed.action === "CREATE_DRAFT") return createDraft(context, payload);
    if (parsed.action === "SAVE_DRAFT") return saveDraft(context, payload);
    if (parsed.action === "VALIDATE") { await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_READ, resource(context.workspaceId)); return validateAutomationGraph(parseGraph(payload.graph)); }
    if (parsed.action === "SIMULATE") { await options.authorization.assertAuthorized(context, PermissionKeys.AUTOMATIONS_EXECUTE, resource(context.workspaceId)); return simulate(parseGraph(payload.graph), record(payload.payload ?? payload.input)); }
    if (parsed.action === "PUBLISH") return publish(context, payload);
    if (parsed.action === "ROLLBACK") return rollback(context, payload);
    if (parsed.action === "START_RUN") return startRun(context, payload);
    if (parsed.action === "ADVANCE_RUN") return advanceRun(context, payload);
    return replayNode(context, payload);
  }

  return Object.freeze({ screen, command });
}

let singleton: ReturnType<typeof createAutomationBuilderService> | undefined;
export function getAutomationBuilderService() {
  singleton ??= createAutomationBuilderService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}

export type AutomationBuilderScreen = Awaited<ReturnType<ReturnType<typeof createAutomationBuilderService>["screen"]>>;
