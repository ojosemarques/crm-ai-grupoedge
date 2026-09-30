import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getGovernedAgentService } from "@/modules/ai-agents/application/governed-agent-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { acceptanceGraph, getAutomationBuilderService } from "@/modules/automations/application/automation-builder-service";
import {
  assistantCommandSchema,
  inferManagerQuestion,
  inferProposalType,
  type AssistantCommand,
  type AssistantProposalType,
} from "@/modules/ai-assistant/domain/assistant-contracts";
import { getManagerAnalyticsService } from "@/modules/metrics/application/manager-analytics-service";
import { getPipelineTemplateService } from "@/modules/pipeline-templates/application/pipeline-template-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { AccessRoleKeys, PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Analytics = ReturnType<typeof getManagerAnalyticsService>;
type AgentService = ReturnType<typeof getGovernedAgentService>;
type AutomationService = ReturnType<typeof getAutomationBuilderService>;
type PipelineService = ReturnType<typeof getPipelineTemplateService>;
type Options = Readonly<{
  database: PrismaClient;
  authorization: Pick<Authorization, "authorize" | "assertAuthorized">;
  analytics: Analytics;
  agents: AgentService;
  automations: AutomationService;
  pipelines: PipelineService;
  now: () => Date;
}>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const workspaceResource = (context: AuthenticatedContext) => ({ workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId });
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 41) || "configuracao";
const compact = (value: string, size = 90) => value.replace(/\s+/g, " ").trim().slice(0, size);

function fail(message: string, code = "INVALID_ASSISTANT_OPERATION", statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function proposalBlueprint(type: AssistantProposalType, request: string, proposalNonce: string) {
  const title = compact(request, 72);
  if (type === "AGENT") {
    const definition = {
      instructions: "Atenda de forma consultiva usando somente a base aprovada. Declare ausência, peça handoff quando houver baixa confiança e apenas proponha ações comerciais sensíveis.",
      tone: "CONSULTATIVE" as const,
      audience: "Leads e contas comerciais autorizados no CRM",
      offerScope: "Somente produtos ativos e condições comerciais aprovadas",
      model: "local-deterministic-v1" as const,
      budgetCents: 0,
      maxInputTokens: 2_000,
      maxOutputTokens: 700,
      allowedDataFields: ["lead.name", "lead.lifecycle", "opportunity.stage", "conversation.messages", "catalog.active_products"] as const,
      allowedTools: ["SEARCH_APPROVED_KB", "PROPOSE_FIELDS", "REQUEST_HANDOFF", "PROPOSE_SENSITIVE_ACTION"] as const,
      knowledge: { title: "Base comercial aprovada", content: "Use apenas o catálogo comercial ativo, os registros autorizados do CRM e as condições aprovadas. Quando a fonte não trouxer a resposta, declare ausência e transfira para uma pessoa.", sourceReference: "crm://catalog/active" },
    };
    return {
      payload: { name: title, objective: `Executar com segurança: ${compact(request, 300)}`, definition },
      diff: [{ path: "agent", label: "Agente", before: null, after: title }, { path: "agent.status", label: "Estado", before: null, after: "Rascunho avaliado antes da publicação" }],
      impact: ["Cria um agente governado e uma versão imutável.", "Não executa ação comercial sem aprovação humana."],
      preview: { title, summary: "Agente grounded com catálogo ativo, handoff e orçamento local zero.", fields: [{ label: "Modelo", value: "Determinístico local" }, { label: "Tom", value: "Consultivo" }] },
    };
  }
  if (type === "AUTOMATION") {
    return {
      payload: { name: title },
      diff: [{ path: "automation", label: "Automação", before: null, after: title }, { path: "automation.execution", label: "Execução", before: null, after: "Fluxo versionado validado" }],
      impact: ["Cria e valida um fluxo visual seguro.", "Publica uma versão imutável; não inicia execução automaticamente."],
      preview: { title, summary: "Automação padrão com triagem, tarefa, espera, condição e handoff.", fields: [{ label: "Execução automática", value: "Não" }, { label: "Undo", value: "Disponível" }] },
    };
  }
  if (type === "PIPELINE_MODEL") {
    const key = `${slug(title)}-${proposalNonce.replaceAll("-", "").slice(0, 8)}`;
    return {
      payload: { key, name: title, entityType: "OPPORTUNITY", stages: [
        { stableKey: "diagnostico", name: "Diagnóstico", position: 0, type: "OPEN", opportunityStageCode: "OPPORTUNITY_CONFIRMED", activities: [], requiredFields: [] },
        { stableKey: "proposta", name: "Proposta", position: 1, type: "OPEN", opportunityStageCode: "PROPOSAL", activities: [], requiredFields: [] },
        { stableKey: "negociacao", name: "Negociação", position: 2, type: "OPEN", opportunityStageCode: "NEGOTIATION", activities: [], requiredFields: [] },
        { stableKey: "ganho", name: "Ganho", position: 3, type: "WON", opportunityStageCode: "WON", activities: [], requiredFields: [] },
        { stableKey: "perdido", name: "Perdido", position: 4, type: "LOST", opportunityStageCode: "LOST", activities: [], requiredFields: [] },
      ] },
      diff: [{ path: "pipelineModel", label: "Modelo de funil", before: null, after: title }, { path: "pipelineModel.stages", label: "Etapas", before: null, after: "Diagnóstico → Proposta → Negociação → Ganho/Perdido" }],
      impact: ["Cria um modelo versionado sem migrar pipelines existentes.", "Aplicação futura exige uma prévia de migração própria."],
      preview: { title, summary: "Modelo de oportunidades em cinco etapas; nenhum card será movido.", fields: [{ label: "Etapas", value: "5" }, { label: "Pipelines afetados", value: "0" }] },
    };
  }
  return {
    payload: { name: title, metricId: "sales.win_rate", visualization: "FUNNEL", period: "MONTH", filters: [] },
    diff: [{ path: "chart", label: "Gráfico", before: null, after: title }, { path: "chart.metric", label: "Métrica canônica", before: null, after: "Taxa de conversão do funil" }],
    impact: ["Publica uma configuração versionada de gráfico.", "A leitura respeita período e permissões do usuário."],
    preview: { title, summary: "Gráfico mensal baseado no catálogo canônico de métricas.", fields: [{ label: "Métrica", value: "Conversão do funil" }, { label: "Período", value: "Mês" }] },
  };
}

function serializeProposal(proposal: {
  id: string; type: string; status: string; request: string; diff: unknown; impact: unknown; preview: unknown; revision: number;
  publishedTargetType: string | null; publishedTargetId: string | null; publishedTargetVersionId: string | null; publishedVersionId: string | null; createdAt: Date; updatedAt: Date;
}) {
  return { ...proposal, createdAt: proposal.createdAt.toISOString(), updatedAt: proposal.updatedAt.toISOString(), publishedTarget: proposal.publishedTargetType ? { type: proposal.publishedTargetType, id: proposal.publishedTargetId, versionId: proposal.publishedTargetVersionId } : null };
}

export function createAssistantService(options: Options) {
  async function assistantResource(context: AuthenticatedContext) {
    const membership = await options.database.teamMember.findFirst({
      where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null, team: { deletedAt: null } },
      orderBy: { teamId: "asc" },
      select: { teamId: true },
    });
    return { ...workspaceResource(context), teamId: membership?.teamId ?? null };
  }

  async function assertAdmin(context: AuthenticatedContext) {
    if (context.roleKey !== AccessRoleKeys.ADMINISTRATOR) fail("Somente administradores podem publicar ou desfazer configurações.", "ADMIN_APPROVAL_REQUIRED", 403);
    await options.authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MANAGE, workspaceResource(context));
  }

  async function screen(context: AuthenticatedContext) {
    const resource = await assistantResource(context);
    const [query, propose, manage] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.AI_MANAGER_QUERY, resource),
      options.authorization.authorize(context, PermissionKeys.AI_USE, resource),
      options.authorization.authorize(context, PermissionKeys.WORKSPACE_MANAGE, workspaceResource(context)),
    ]);
    const canApprove = context.roleKey === AccessRoleKeys.ADMINISTRATOR && manage.allowed;
    if (!query.allowed && !propose.allowed) fail("Você não possui acesso ao assistente.", "ACCESS_DENIED", 403);
    const proposals = await options.database.aIAssistantProposal.findMany({ where: { workspaceId: context.workspaceId, type: { in: ["AGENT", "PIPELINE_MODEL", "AUTOMATION", "CHART"] }, ...(!canApprove ? { requestedByActorId: context.actorId } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100 });
    return {
      generatedAt: options.now().toISOString(),
      capabilities: { canQuery: query.allowed, canPropose: propose.allowed, canApprove, canUndo: canApprove },
      voiceGate: { enabled: false, status: "BLOCKED_PENDING_EVALUATION", checks: [
        { key: "quality", label: "Qualidade e taxa de erro da transcrição", passed: false },
        { key: "privacy", label: "Privacidade, retenção e consentimento", passed: false },
        { key: "cost", label: "Custo e limites do provedor", passed: false },
      ] },
      periods: ["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"],
      proposalTypes: [{ key: "AGENT", label: "Agente" }, { key: "PIPELINE_MODEL", label: "Funil/modelo" }, { key: "AUTOMATION", label: "Automação" }, { key: "CHART", label: "Gráfico" }],
      proposals: proposals.map(serializeProposal),
    };
  }

  async function query(context: AuthenticatedContext, payload: Extract<AssistantCommand, { action: "QUERY" }>["payload"]) {
    const shell = await options.analytics.getShell(context, { preset: payload.preset, ...(payload.fromDate ? { fromDate: payload.fromDate } : {}), ...(payload.toDate ? { toDate: payload.toDate } : {}) });
    const questionId = inferManagerQuestion(payload.question);
    if (!questionId) {
      return { classification: { data: [], inference: [], absence: ["A pergunta não corresponde a uma métrica homologada do catálogo canônico."] }, answer: null, sources: [{ label: "Catálogo canônico de métricas crm57.1", kind: "CATALOG" }], links: [], permissionScope: "FILTERED_BY_ROLE_AND_TEAM" };
    }
    const answer = await options.analytics.answer(context, { questionId, query: shell.query });
    const absence = [...answer.limitations];
    if (!answer.relatedRecords.length) absence.unshift("Nenhum registro autorizado foi encontrado para a pergunta e o período.");
    return {
      classification: {
        data: [answer.directAnswer, ...answer.numbers.map((number) => `${number.label}: ${number.value ?? "ausente"}`)],
        inference: answer.possibleCauses,
        absence,
      },
      answer: { directAnswer: answer.directAnswer, period: answer.period, formula: answer.formula, numbers: answer.numbers, confidence: answer.confidence },
      sources: [{ label: "Catálogo canônico de métricas crm57.1", kind: "CATALOG" }, ...answer.evidence.map((label) => ({ label, kind: "CRM_RECORD" }))],
      links: answer.relatedRecords.map((record) => ({ label: record.title, href: record.href, entityType: record.entityType })),
      permissionScope: answer.scope === "TEAM" ? "TEAM" : "WORKSPACE",
    };
  }

  async function propose(context: AuthenticatedContext, payload: Extract<AssistantCommand, { action: "PROPOSE" }>["payload"]) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, await assistantResource(context));
    const type = payload.type ?? inferProposalType(payload.request);
    if (!type) fail("O tipo de configuração é ambíguo. Escolha agente, funil/modelo, automação ou gráfico.", "AMBIGUOUS_CONFIGURATION_TYPE", 400);
    const blueprint = proposalBlueprint(type, payload.request, randomUUID());
    const requestFingerprint = fingerprint({ type, request: payload.request });
    const created = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant-proposal:${context.workspaceId}:${context.actorId}:${requestFingerprint}`}, 0))`;
      const replay = await tx.aIAssistantProposal.findFirst({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, requestFingerprint, status: "DRAFT" } });
      if (replay) return replay;
      const draft = await tx.aIAssistantProposal.create({ data: { workspaceId: context.workspaceId, type, request: payload.request, payload: json(blueprint.payload), diff: json(blueprint.diff), impact: json(blueprint.impact), preview: json(blueprint.preview), requestFingerprint, requestedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.created", entityType: "AIAssistantProposal", entityId: draft.id, changes: json({ type, status: "DRAFT", diff: blueprint.diff, impact: blueprint.impact, domainMutationExecuted: false }) } });
      return draft;
    });
    return serializeProposal(created);
  }

  async function cancel(context: AuthenticatedContext, payload: Extract<AssistantCommand, { action: "CANCEL" }>["payload"]) {
    await options.database.$transaction(async (tx) => {
      const result = await tx.aIAssistantProposal.updateMany({ where: { id: payload.proposalId, workspaceId: context.workspaceId, requestedByActorId: context.actorId, status: "DRAFT", revision: payload.expectedRevision }, data: { status: "CANCELLED", revision: { increment: 1 }, cancellationReason: payload.reason, cancelledByActorId: context.actorId, cancelledAt: options.now() } });
      if (!result.count) fail("Rascunho inexistente, alterado ou já finalizado.", "PROPOSAL_REVISION_CONFLICT", 409);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.cancelled", entityType: "AIAssistantProposal", entityId: payload.proposalId, reason: payload.reason, changes: { domainMutationExecuted: false } } });
    });
    const proposal = await options.database.aIAssistantProposal.findUniqueOrThrow({ where: { id: payload.proposalId } });
    return serializeProposal(proposal);
  }

  async function publishTarget(context: AuthenticatedContext, proposal: { id: string; type: string; payload: Prisma.JsonValue }, reason: string) {
    const payload = proposal.payload as Record<string, unknown>;
    if (proposal.type === "AGENT") {
      const created = await options.agents.command(context, { action: "CREATE_AGENT", payload: payload as never }) as { id: string };
      await options.agents.command(context, { action: "EVALUATE", payload: { agentId: created.id } });
      const version = await options.agents.command(context, { action: "PUBLISH", payload: { agentId: created.id, reason } }) as { id: string; version: number };
      return { targetType: "GovernedAgent", targetId: created.id, targetVersionId: version.id, targetVersion: version.version };
    }
    if (proposal.type === "AUTOMATION") {
      const graph = { ...acceptanceGraph, name: String(payload.name ?? acceptanceGraph.name), description: `Proposta aprovada pelo assistente: ${String(payload.name ?? "Automação")}` };
      const draft = await options.automations.command(context, { action: "CREATE_DRAFT", payload: { graph } }) as { ruleId: string; draftRevision: number };
      const version = await options.automations.command(context, { action: "PUBLISH", payload: { ruleId: draft.ruleId, expectedRevision: draft.draftRevision } }) as { versionId: string; version: number };
      return { targetType: "AutomationRule", targetId: draft.ruleId, targetVersionId: version.versionId, targetVersion: version.version };
    }
    if (proposal.type === "PIPELINE_MODEL") {
      const result = await options.pipelines.execute(context, { action: "SAVE_TEMPLATE", mode: "SAVE_AS_NEW", pipelineIds: [], changeReason: reason, ...payload }) as { version: { id: string; templateId: string; version: number } };
      return { targetType: "PipelineTemplate", targetId: result.version.templateId, targetVersionId: result.version.id, targetVersion: result.version.version };
    }
    return { targetType: "AssistantChart", targetId: proposal.id, targetVersionId: null, targetVersion: 1 };
  }

  async function approve(context: AuthenticatedContext, payload: Extract<AssistantCommand, { action: "APPROVE" }>["payload"]) {
    await assertAdmin(context);
    const locked = await options.database.aIAssistantProposal.updateMany({ where: { id: payload.proposalId, workspaceId: context.workspaceId, type: { in: ["AGENT", "PIPELINE_MODEL", "AUTOMATION", "CHART"] }, status: "DRAFT", revision: payload.expectedRevision }, data: { status: "PUBLISHING", revision: { increment: 1 } } });
    if (!locked.count) fail("A proposta mudou ou já foi finalizada.", "PROPOSAL_REVISION_CONFLICT", 409);
    const proposal = await options.database.aIAssistantProposal.findUniqueOrThrow({ where: { id: payload.proposalId } });
    let publishedTarget: Awaited<ReturnType<typeof publishTarget>> | null = null;
    try {
      const target = await publishTarget(context, proposal, payload.reason);
      publishedTarget = target;
      const publishedAt = options.now();
      const version = await options.database.$transaction(async (tx) => {
        const assistantVersionId = randomUUID();
        const effectiveTarget = proposal.type === "CHART" ? { ...target, targetVersionId: assistantVersionId } : target;
        const created = await tx.aIAssistantConfigurationVersion.create({ data: { id: assistantVersionId, workspaceId: context.workspaceId, proposalId: proposal.id, version: 1, configurationType: proposal.type, status: "PUBLISHED", snapshot: json({ payload: proposal.payload, diff: proposal.diff, impact: proposal.impact, target: effectiveTarget }), snapshotHash: fingerprint({ payload: proposal.payload, target: effectiveTarget }), targetType: effectiveTarget.targetType, targetId: effectiveTarget.targetId, targetVersionId: effectiveTarget.targetVersionId, publishedByActorId: context.actorId, publishedAt } });
        await tx.aIAssistantProposal.update({ where: { id: proposal.id }, data: { status: "PUBLISHED", publishedTargetType: effectiveTarget.targetType, publishedTargetId: effectiveTarget.targetId, publishedTargetVersionId: effectiveTarget.targetVersionId, publishedVersionId: created.id, approvedReason: payload.reason, approvedByActorId: context.actorId, approvedAt: publishedAt } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.published", entityType: "AIAssistantProposal", entityId: proposal.id, reason: payload.reason, changes: json({ target: effectiveTarget, assistantVersionId: created.id, administratorApproved: true }) } });
        return created;
      });
      const current = await options.database.aIAssistantProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      return { proposal: serializeProposal(current), version: { id: version.id, version: version.version, status: version.status }, target };
    } catch (error) {
      if (publishedTarget?.targetId) {
        try {
          if (proposal.type === "AGENT") await options.agents.command(context, { action: "PAUSE", payload: { agentId: publishedTarget.targetId, reason: "Compensação por falha ao finalizar publicação assistida." } });
          if (proposal.type === "AUTOMATION") await options.automations.command(context, { action: "PAUSE", payload: { ruleId: publishedTarget.targetId, reason: "Compensação por falha ao finalizar publicação assistida." } });
          if (proposal.type === "PIPELINE_MODEL") await options.database.pipelineTemplate.updateMany({ where: { id: publishedTarget.targetId, workspaceId: context.workspaceId }, data: { archivedAt: options.now() } });
        } catch { /* O estado PUBLISH_FAILED impede replay; a auditoria sinaliza revisão manual. */ }
      }
      await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, status: "PUBLISHING" }, data: { status: "PUBLISH_FAILED" } });
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.publish_failed", entityType: "AIAssistantProposal", entityId: proposal.id, changes: json({ retryRequiresNewDraft: true, possiblePartialEffect: Boolean(publishedTarget), target: publishedTarget }) } });
      throw error;
    }
  }

  async function undo(context: AuthenticatedContext, payload: Extract<AssistantCommand, { action: "UNDO" }>["payload"]) {
    await assertAdmin(context);
    const locked = await options.database.aIAssistantProposal.updateMany({ where: { id: payload.proposalId, workspaceId: context.workspaceId, type: { in: ["AGENT", "PIPELINE_MODEL", "AUTOMATION", "CHART"] }, status: "PUBLISHED" }, data: { status: "UNDOING" } });
    if (!locked.count) fail("Somente a versão publicada vigente pode ser desfeita.", "UNDO_UNAVAILABLE", 409);
    const proposal = await options.database.aIAssistantProposal.findUniqueOrThrow({ where: { id: payload.proposalId } });
    try {
      if (proposal.type === "AGENT" && proposal.publishedTargetId) await options.agents.command(context, { action: "PAUSE", payload: { agentId: proposal.publishedTargetId, reason: payload.reason } });
      if (proposal.type === "AUTOMATION" && proposal.publishedTargetId) await options.automations.command(context, { action: "PAUSE", payload: { ruleId: proposal.publishedTargetId, reason: payload.reason } });
      if (proposal.type === "PIPELINE_MODEL" && proposal.publishedTargetId) await options.database.pipelineTemplate.updateMany({ where: { id: proposal.publishedTargetId, workspaceId: context.workspaceId }, data: { archivedAt: options.now() } });
      const prior = await options.database.aIAssistantConfigurationVersion.findFirstOrThrow({ where: { id: proposal.publishedVersionId!, workspaceId: context.workspaceId } });
      const undoneAt = options.now();
      const undoVersion = await options.database.$transaction(async (tx) => {
        const created = await tx.aIAssistantConfigurationVersion.create({ data: { workspaceId: context.workspaceId, proposalId: proposal.id, version: prior.version + 1, configurationType: proposal.type, status: "UNDONE", snapshot: json({ previousVersionId: prior.id, reason: payload.reason, active: false }), snapshotHash: fingerprint({ previousVersionId: prior.id, reason: payload.reason, active: false }), targetType: prior.targetType, targetId: prior.targetId, targetVersionId: prior.targetVersionId, rollbackOfVersionId: prior.id, publishedByActorId: context.actorId, publishedAt: undoneAt } });
        await tx.aIAssistantProposal.update({ where: { id: proposal.id }, data: { status: "UNDONE", undoneByActorId: context.actorId, undoneAt, revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.undone", entityType: "AIAssistantProposal", entityId: proposal.id, reason: payload.reason, changes: json({ rollbackOfVersionId: prior.id, undoVersionId: created.id }) } });
        return created;
      });
      const current = await options.database.aIAssistantProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      return { proposal: serializeProposal(current), version: { id: undoVersion.id, version: undoVersion.version, status: undoVersion.status } };
    } catch (error) {
      await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, status: "UNDOING" }, data: { status: "UNDO_FAILED" } });
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.assistant.proposal.undo_failed", entityType: "AIAssistantProposal", entityId: proposal.id, changes: { possiblePartialEffect: true, manualReviewRequired: true } } });
      throw error;
    }
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const parsed = assistantCommandSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join(" "), "INVALID_ASSISTANT_COMMAND", 400);
    const input = parsed.data;
    switch (input.action) {
      case "QUERY": return query(context, input.payload);
      case "PROPOSE": return propose(context, input.payload);
      case "CANCEL": return cancel(context, input.payload);
      case "APPROVE": return approve(context, input.payload);
      case "UNDO": return undo(context, input.payload);
    }
  }

  return Object.freeze({ screen, command });
}

let singleton: ReturnType<typeof createAssistantService> | undefined;
export function getAssistantService() {
  singleton ??= createAssistantService({ database: getDatabaseClient(), authorization: getAuthorizationService(), analytics: getManagerAnalyticsService(), agents: getGovernedAgentService(), automations: getAutomationBuilderService(), pipelines: getPipelineTemplateService(), now: () => new Date() });
  return singleton;
}
