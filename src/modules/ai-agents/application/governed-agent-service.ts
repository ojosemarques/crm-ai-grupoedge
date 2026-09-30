import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { agentDefinitionSchema, governedAgentCommandSchema, internalSubagents } from "@/modules/ai-agents/domain/governed-agent-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now?: () => Date }>;
type Command = ReturnType<typeof governedAgentCommandSchema.parse>;
type CommandPayload<Action extends Command["action"]> = Extract<Command, { action: Action }>["payload"];
const resource = (context: AuthenticatedContext) => ({ workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string, code = "INVALID_AGENT_OPERATION", statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }

export const evaluateAgentDefinition = (definition: ReturnType<typeof agentDefinitionSchema.parse>) => {
  const text = `${definition.instructions}\n${definition.knowledge.content}`;
  const issues: string[] = [];
  const grounding = definition.knowledge.content.length >= 20 && definition.allowedTools.includes("SEARCH_APPROVED_KB");
  const futureOffer = !/(?:ia|governo).{0,60}(?:futur|em breve|lan[çc]a|roadmap|ainda n[aã]o dispon[ií]vel)|(?:futur|em breve|lan[çc]a|roadmap|ainda n[aã]o dispon[ií]vel).{0,60}(?:ia|governo)|produto ainda n[aã]o dispon[ií]vel/i.test(text);
  const pii = !/(cpf|senha|password|token|segredo|título de eleitor)/i.test(text);
  const promptInjection = !/(ignore|desconsidere).{0,30}instru|system prompt|developer message/i.test(text);
  const lowConfidenceHandoff = definition.allowedTools.includes("REQUEST_HANDOFF");
  const sensitiveApproval = definition.allowedTools.includes("PROPOSE_SENSITIVE_ACTION");
  if (!grounding) issues.push("Base aprovada e busca grounded são obrigatórias.");
  if (!futureOffer) issues.push("Promessa de IA ou Governo futuro detectada.");
  if (!pii) issues.push("Solicitação de dado pessoal restrito detectada.");
  if (!promptInjection) issues.push("Conteúdo semelhante a prompt injection detectado.");
  if (!lowConfidenceHandoff) issues.push("Handoff por baixa confiança não configurado.");
  if (!sensitiveApproval) issues.push("Aprovação de ação sensível não configurada.");
  return { passed: issues.length === 0, grounding, futureOffer, pii, promptInjection, lowConfidenceHandoff, sensitiveApproval, issues };
};

export function inferGovernedTurn(definition: ReturnType<typeof agentDefinitionSchema.parse>, message: string) {
  const normalized = message.toLowerCase();
  const injection = /(ignore|desconsidere).{0,30}instru|system prompt|developer message/i.test(message);
  const sensitive = /(preço|valor|proposta|desconto|mudar etapa|fechar negócio)/i.test(message);
  const intent = sensitive ? "SENSITIVE" : /(quero|contratar|produto|solução)/i.test(message) ? "COMMERCIAL" : /(nome|empresa|cargo|necessidade)/i.test(message) ? "QUALIFICATION" : /(como|qual|o que)/i.test(message) ? "INFORMATION" : "UNKNOWN";
  const knowledgeWords = new Set(definition.knowledge.content.toLowerCase().split(/\W+/).filter((word) => word.length > 4));
  const grounded = normalized.split(/\W+/).some((word) => knowledgeWords.has(word));
  const confidenceBps = injection ? 0 : grounded ? 8_000 : 3_500;
  const handoffReason = injection ? "PROMPT_INJECTION" : confidenceBps < 5_000 ? "LOW_CONFIDENCE" : null;
  const pendingApproval = sensitive && !handoffReason;
  const response = handoffReason || pendingApproval ? null : definition.knowledge.content.slice(0, 700);
  return {
    response, status: handoffReason ? "HANDOFF" : pendingApproval ? "PENDING_APPROVAL" : "RESPONDED",
    intent, handoffReason, noResponse: response === null, confidenceBps,
    sources: [{ title: definition.knowledge.title, reference: definition.knowledge.sourceReference }],
    proposedFields: intent === "QUALIFICATION" ? { qualificationSummary: message.slice(0, 300) } : {},
    summary: handoffReason ? "Conversa encaminhada ao humano com contexto e fonte." : pendingApproval ? "Ação comercial sensível aguarda aprovação humana." : "Resposta grounded na base aprovada.",
    costCents: 0, externalEgress: false, sensitiveAction: pendingApproval ? "COMMERCIAL_COMMITMENT" : null,
  } as const;
}

export type StartGovernedConversationInput = Readonly<{
  agentId: string;
  conversationId: string;
  idempotencyKey: string;
  message: string;
}>;

export async function startGovernedConversationInTransaction(
  tx: Prisma.TransactionClient,
  context: AuthenticatedContext,
  payload: StartGovernedConversationInput,
  now: () => Date,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-conversation:${context.workspaceId}:${payload.conversationId}`}, 0))`;
  const replay = await tx.agentConversationTurn.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: payload.idempotencyKey } } });
  if (replay) return { turnId: replay.id, response: replay.response, status: replay.status, confidenceBps: replay.confidenceBps, sources: replay.sources, proposedFields: replay.proposedFields, summary: replay.summary, externalEgress: false as const, duplicated: true };
  const [conversation, agent] = await Promise.all([
    tx.conversation.findFirst({ where: { id: payload.conversationId, workspaceId: context.workspaceId } }),
    tx.governedAgent.findFirst({ where: { id: payload.agentId, workspaceId: context.workspaceId, status: "ACTIVE" } }),
  ]);
  if (!conversation || !agent?.activeVersionId) fail("Conversa ou agente ativo não encontrado.", "NOT_FOUND", 404);
  const version = await tx.governedAgentVersion.findFirstOrThrow({ where: { id: agent.activeVersionId, workspaceId: context.workspaceId } });
  const definition = agentDefinitionSchema.parse(version.definition);
  const inferred = inferGovernedTurn(definition, payload.message);
  const current = await tx.agentConversationLease.findUnique({ where: { workspaceId_conversationId: { workspaceId: context.workspaceId, conversationId: conversation.id } } });
  if (current && (["HUMAN_PAUSED", "HANDOFF"].includes(current.status) || (current.status === "ACTIVE" && current.agentId !== agent.id))) fail("A conversa já possui outro dono ou está pausada para humano; novo gatilho de retomada é necessário.", "CONVERSATION_LEASE_CONFLICT");
  const lease = current
    ? await tx.agentConversationLease.update({ where: { id: current.id }, data: { agentId: agent.id, agentVersionId: version.id, status: inferred.status === "HANDOFF" ? "HANDOFF" : "ACTIVE", leaseToken: randomUUID(), lastTriggerKey: payload.idempotencyKey, acquiredAt: now(), pausedAt: inferred.status === "HANDOFF" ? now() : null, pausedReason: inferred.handoffReason } })
    : await tx.agentConversationLease.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, agentId: agent.id, agentVersionId: version.id, status: inferred.status === "HANDOFF" ? "HANDOFF" : "ACTIVE", leaseToken: randomUUID(), lastTriggerKey: payload.idempotencyKey, acquiredAt: now(), pausedAt: inferred.status === "HANDOFF" ? now() : null, pausedReason: inferred.handoffReason } });
  const turn = await tx.agentConversationTurn.create({ data: { workspaceId: context.workspaceId, leaseId: lease.id, conversationId: conversation.id, agentVersionId: version.id, idempotencyKey: payload.idempotencyKey, status: inferred.status, userMessageFingerprint: hash(payload.message), response: inferred.response, summary: inferred.summary, sources: json(inferred.sources), proposedFields: json(inferred.proposedFields), confidenceBps: inferred.confidenceBps, sensitiveAction: inferred.sensitiveAction, approvalStatus: inferred.sensitiveAction ? "PENDING" : null, costCents: 0, externalEgress: false, completedAt: now() } });
  return { turnId: turn.id, ...inferred, duplicated: false };
}

export function createGovernedAgentService(options: Options) {
  const now = options.now ?? (() => new Date());
  async function screen(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_READ, resource(context));
    const [manage, evaluate, use, agents, leases, metricRows, activeProducts] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context)),
      options.authorization.authorize(context, PermissionKeys.AI_EVALUATIONS_RUN, resource(context)),
      options.authorization.authorize(context, PermissionKeys.AI_USE, resource(context)),
      options.database.governedAgent.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
      options.database.agentConversationLease.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["ACTIVE", "HUMAN_PAUSED", "HANDOFF"] } }, orderBy: { updatedAt: "desc" }, take: 50 }),
      options.database.agentConversationTurn.findMany({ where: { workspaceId: context.workspaceId }, select: { costCents: true, corrected: true, status: true, approvalStatus: true } }),
      options.database.product.findMany({ where: { workspaceId: context.workspaceId, active: true, availability: "AVAILABLE", deletedAt: null, OR: [{ availableFrom: null }, { availableFrom: { lte: now() } }], AND: [{ OR: [{ availableUntil: null }, { availableUntil: { gt: now() } }] }] }, select: { id: true, sku: true, name: true, description: true, audience: true, approvedConditions: true }, orderBy: [{ name: "asc" }, { version: "desc" }] }),
    ]);
    const versions = agents.length ? await options.database.governedAgentVersion.findMany({ where: { workspaceId: context.workspaceId, agentId: { in: agents.map((agent) => agent.id) } }, orderBy: { version: "desc" } }) : [];
    return { generatedAt: now().toISOString(), providerGate: { approved: true, mode: "LOCAL_DETERMINISTIC", externalEgress: false }, capabilities: { canRead: true, canManage: manage.allowed, canEvaluate: evaluate.allowed, canUse: use.allowed },
      agents: agents.map((agent) => ({ ...agent, createdAt: agent.createdAt.toISOString(), updatedAt: agent.updatedAt.toISOString(), versions: versions.filter((version) => version.agentId === agent.id).map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })) })),
      subagents: internalSubagents, leases: leases.map((lease) => ({ ...lease, acquiredAt: lease.acquiredAt.toISOString(), pausedAt: lease.pausedAt?.toISOString() ?? null, updatedAt: lease.updatedAt.toISOString() })),
      metrics: { cases: metricRows.length, corrections: metricRows.filter((row) => row.corrected).length, totalCostCents: metricRows.reduce((sum, row) => sum + row.costCents, 0), averageCostCents: metricRows.length ? Math.round(metricRows.reduce((sum, row) => sum + row.costCents, 0) / metricRows.length) : 0, handoffs: metricRows.filter((row) => row.status === "HANDOFF").length, sensitiveApprovalsPending: metricRows.filter((row) => row.approvalStatus === "PENDING").length },
      catalog: { models: [{ key: "local-deterministic-v1", label: "Determinístico local", external: false }], tones: [{ key: "CONSULTATIVE", label: "Consultivo" }, { key: "DIRECT", label: "Direto" }, { key: "EMPATHETIC", label: "Empático" }], allowedTools: [{ key: "SEARCH_APPROVED_KB", label: "Buscar base aprovada", sensitive: false }, { key: "PROPOSE_FIELDS", label: "Propor campos", sensitive: false }, { key: "REQUEST_HANDOFF", label: "Solicitar handoff", sensitive: false }, { key: "PROPOSE_SENSITIVE_ACTION", label: "Propor ação sensível", sensitive: true }], allowedDataFields: [{ key: "lead.name", label: "Nome do lead" }, { key: "lead.lifecycle", label: "Lifecycle" }, { key: "opportunity.stage", label: "Etapa da oportunidade" }, { key: "conversation.messages", label: "Mensagens da conversa" }, { key: "catalog.active_products", label: "Produtos ativos" }], activeProducts: activeProducts.map((product) => ({ ...product, approvedSource: true })), activeProductsOnly: true, osCitizenDataSeparated: true } };
  }

  async function createAgent(context: AuthenticatedContext, payload: CommandPayload<"CREATE_AGENT">) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context));
    const key = `${payload.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-${randomUUID().slice(0, 8)}`;
    return options.database.governedAgent.create({ data: { workspaceId: context.workspaceId, key, name: payload.name, objective: payload.objective, draftDefinition: json(payload.definition), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
  }
  async function saveDraft(context: AuthenticatedContext, payload: CommandPayload<"SAVE_DRAFT">) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context));
    const updated = await options.database.governedAgent.updateMany({ where: { id: payload.agentId, workspaceId: context.workspaceId, draftRevision: payload.expectedRevision }, data: { name: payload.name, objective: payload.objective, draftDefinition: json(payload.definition), draftRevision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: now() } });
    if (!updated.count) fail("O rascunho foi alterado. Recarregue.", "REVISION_CONFLICT");
    return options.database.governedAgent.findUniqueOrThrow({ where: { id: payload.agentId } });
  }
  async function evaluate(context: AuthenticatedContext, agentId: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_EVALUATIONS_RUN, resource(context));
    const agent = await options.database.governedAgent.findFirst({ where: { id: agentId, workspaceId: context.workspaceId } }); if (!agent) fail("Agente não encontrado.", "NOT_FOUND", 404);
    const definition = agentDefinitionSchema.parse(agent.draftDefinition); const evaluation = evaluateAgentDefinition(definition);
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.agent.evaluated", entityType: "GovernedAgent", entityId: agent.id, changes: json({ evaluation }) } });
    return evaluation;
  }
  async function publish(context: AuthenticatedContext, agentId: string, reason: string, rollbackOfVersionId?: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent:${context.workspaceId}:${agentId}`}))`;
      const agent = await tx.governedAgent.findFirst({ where: { id: agentId, workspaceId: context.workspaceId } }); if (!agent) fail("Agente não encontrado.", "NOT_FOUND", 404);
      const definition = agentDefinitionSchema.parse(agent.draftDefinition); const evaluation = evaluateAgentDefinition(definition); if (!evaluation.passed) fail(`Avaliação reprovada: ${evaluation.issues.join(" ")}`);
      const latest = await tx.governedAgentVersion.findFirst({ where: { workspaceId: context.workspaceId, agentId }, orderBy: { version: "desc" } }); const versionNumber = (latest?.version ?? 0) + 1;
      const version = await tx.governedAgentVersion.create({ data: { workspaceId: context.workspaceId, agentId, version: versionNumber, definition: json(definition), definitionHash: hash(definition), knowledgeBaseVersion: versionNumber, evaluation: json(evaluation), ...(rollbackOfVersionId ? { rollbackOfVersionId } : {}), createdByActorId: context.actorId } });
      await tx.agentKnowledgeDocument.create({ data: { workspaceId: context.workspaceId, agentId, version: versionNumber, title: definition.knowledge.title, content: definition.knowledge.content, contentHash: hash(definition.knowledge.content), sourceReference: definition.knowledge.sourceReference, approved: true, createdByActorId: context.actorId } });
      await tx.governedAgent.update({ where: { id: agent.id }, data: { status: "ACTIVE", activeVersionId: version.id, updatedByActorId: context.actorId, updatedAt: now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: rollbackOfVersionId ? "ai.agent.rolled_back" : "ai.agent.published", entityType: "GovernedAgentVersion", entityId: version.id, reason, changes: json({ version: versionNumber, evaluation, externalEgress: false }) } });
      return { ...version, evaluation };
    });
  }
  async function simulate(context: AuthenticatedContext, agentId: string, message: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource(context));
    const agent = await options.database.governedAgent.findFirst({ where: { id: agentId, workspaceId: context.workspaceId } }); if (!agent) fail("Agente não encontrado.", "NOT_FOUND", 404);
    const definition = agentDefinitionSchema.parse(agent.draftDefinition); return { turnId: randomUUID(), ...inferGovernedTurn(definition, message), simulated: true };
  }
  async function startConversation(context: AuthenticatedContext, payload: CommandPayload<"START_CONVERSATION">) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource(context));
    return options.database.$transaction((tx) => startGovernedConversationInTransaction(tx, context, payload, now));
  }
  async function humanReply(context: AuthenticatedContext, payload: CommandPayload<"HUMAN_REPLY">) { await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource(context)); return options.database.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-conversation:${context.workspaceId}:${payload.conversationId}`}, 0))`; const updated = await tx.agentConversationLease.updateMany({ where: { workspaceId: context.workspaceId, conversationId: payload.conversationId, status: "ACTIVE" }, data: { status: "HUMAN_PAUSED", pausedAt: now(), pausedReason: payload.reason, humanOwnerMemberId: context.memberId } }); if (!updated.count) fail("Não há agente ativo nessa conversa."); return { paused: true, concurrentAgentMessageAllowed: false }; }); }
  async function resume(context: AuthenticatedContext, payload: CommandPayload<"RESUME">) { await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource(context)); return options.database.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-conversation:${context.workspaceId}:${payload.conversationId}`}, 0))`; const current = await tx.agentConversationLease.findUnique({ where: { workspaceId_conversationId: { workspaceId: context.workspaceId, conversationId: payload.conversationId } } }); if (!current) fail("A conversa não possui agente para retomada."); if (current.status === "ACTIVE" && current.lastTriggerKey === payload.idempotencyKey) return { resumed: true, requiresNewTrigger: true, duplicated: true }; if (!["HUMAN_PAUSED", "HANDOFF"].includes(current.status)) fail("A conversa não está pausada para retomada."); await tx.agentConversationLease.update({ where: { id: current.id }, data: { status: "ACTIVE", pausedAt: null, pausedReason: null, humanOwnerMemberId: null, lastTriggerKey: payload.idempotencyKey, leaseToken: randomUUID(), acquiredAt: now() } }); return { resumed: true, requiresNewTrigger: true, duplicated: false }; }); }
  async function approveSensitive(context: AuthenticatedContext, payload: CommandPayload<"APPROVE_SENSITIVE">) { await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context)); const updated = await options.database.agentConversationTurn.updateMany({ where: { id: payload.turnId, workspaceId: context.workspaceId, approvalStatus: "PENDING" }, data: { approvalStatus: payload.decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalReason: payload.reason, approvedByActorId: context.actorId, corrected: payload.decision === "REJECT" } }); if (!updated.count) fail("Ação sensível pendente não encontrada."); return { approved: payload.decision === "APPROVE", applied: false } }
  type CommandResults = {
    CREATE_AGENT: Awaited<ReturnType<typeof createAgent>>;
    SAVE_DRAFT: Awaited<ReturnType<typeof saveDraft>>;
    EVALUATE: Awaited<ReturnType<typeof evaluate>>;
    PUBLISH: Awaited<ReturnType<typeof publish>>;
    PAUSE: Awaited<ReturnType<PrismaClient["governedAgent"]["updateMany"]>>;
    ROLLBACK: Awaited<ReturnType<typeof publish>>;
    SIMULATE: Awaited<ReturnType<typeof simulate>>;
    START_CONVERSATION: Awaited<ReturnType<typeof startConversation>>;
    HUMAN_REPLY: Awaited<ReturnType<typeof humanReply>>;
    RESUME: Awaited<ReturnType<typeof resume>>;
    APPROVE_SENSITIVE: Awaited<ReturnType<typeof approveSensitive>>;
  };
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "CREATE_AGENT" }>): Promise<CommandResults["CREATE_AGENT"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "SAVE_DRAFT" }>): Promise<CommandResults["SAVE_DRAFT"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "EVALUATE" }>): Promise<CommandResults["EVALUATE"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "PUBLISH" }>): Promise<CommandResults["PUBLISH"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "PAUSE" }>): Promise<CommandResults["PAUSE"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "ROLLBACK" }>): Promise<CommandResults["ROLLBACK"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "SIMULATE" }>): Promise<CommandResults["SIMULATE"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "START_CONVERSATION" }>): Promise<CommandResults["START_CONVERSATION"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "HUMAN_REPLY" }>): Promise<CommandResults["HUMAN_REPLY"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "RESUME" }>): Promise<CommandResults["RESUME"]>;
  function command(context: AuthenticatedContext, raw: Extract<Command, { action: "APPROVE_SENSITIVE" }>): Promise<CommandResults["APPROVE_SENSITIVE"]>;
  function command(context: AuthenticatedContext, raw: unknown): Promise<unknown>;
  async function command(context: AuthenticatedContext, raw: unknown): Promise<unknown> {
    const input = governedAgentCommandSchema.parse(raw);
    switch (input.action) {
      case "CREATE_AGENT": return createAgent(context, input.payload); case "SAVE_DRAFT": return saveDraft(context, input.payload); case "EVALUATE": return evaluate(context, input.payload.agentId); case "PUBLISH": return publish(context, input.payload.agentId, input.payload.reason); case "PAUSE": await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, resource(context)); return options.database.governedAgent.updateMany({ where: { id: input.payload.agentId, workspaceId: context.workspaceId }, data: { status: "PAUSED", updatedByActorId: context.actorId, updatedAt: now() } }); case "ROLLBACK": { const target = await options.database.governedAgentVersion.findFirst({ where: { id: input.payload.targetVersionId, agentId: input.payload.agentId, workspaceId: context.workspaceId } }); if (!target) fail("Versão de rollback não encontrada.", "NOT_FOUND", 404); await options.database.governedAgent.update({ where: { id: input.payload.agentId }, data: { draftDefinition: json(target.definition), draftRevision: { increment: 1 }, updatedByActorId: context.actorId } }); return publish(context, input.payload.agentId, input.payload.reason, target.id); } case "SIMULATE": return simulate(context, input.payload.agentId, input.payload.message); case "START_CONVERSATION": return startConversation(context, input.payload); case "HUMAN_REPLY": return humanReply(context, input.payload); case "RESUME": return resume(context, input.payload); case "APPROVE_SENSITIVE": return approveSensitive(context, input.payload);
    }
  }
  return Object.freeze({ screen, command });
}

let singleton: ReturnType<typeof createGovernedAgentService> | undefined;
export function getGovernedAgentService() { singleton ??= createGovernedAgentService({ database: getDatabaseClient(), authorization: getAuthorizationService() }); return singleton; }
