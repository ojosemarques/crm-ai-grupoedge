import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { governanceTransitionSchema, humanDecisionInputSchema } from "@/modules/ai/domain/ai-governance-contracts";
import { AI_EVALUATION_DATASET_KEY, AI_EVALUATION_DATASET_VERSION } from "@/modules/ai/evals/dataset-v1";
import { runLocalAIEvaluation } from "@/modules/ai/evals/local-evaluation-runner";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Readonly<{
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.AI_GOVERNANCE_READ | typeof PermissionKeys.AI_GOVERNANCE_MANAGE | typeof PermissionKeys.AI_EVALUATIONS_RUN | typeof PermissionKeys.AI_USE,
    resource: { workspaceId: string; resourceType: string; resourceId: string },
  ) => Promise<void>;
}>;

type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now?: () => Date }>;

function workspaceResource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId } as const;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function invalid(message: string, code = "INVALID_AI_GOVERNANCE_TRANSITION"): never {
  throw new ApplicationError(message, { code, statusCode: 409, expose: true });
}

export function createAIGovernanceService(options: Options) {
  const now = options.now ?? (() => new Date());

  async function getScreen(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_READ, workspaceResource(context));
    const since = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);
    const [workspace, versions, executions, decisions, evaluations] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
      options.database.aIUseCaseVersion.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ key: "asc" }, { version: "desc" }],
        include: {
          owner: { select: { user: { select: { displayName: true } } } },
          approvedBy: { select: { displayName: true } },
          evaluationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      options.database.aIExecutionTrace.groupBy({
        by: ["status"], where: { workspaceId: context.workspaceId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true },
      }),
      options.database.aIHumanDecision.groupBy({
        by: ["decision"], where: { workspaceId: context.workspaceId, createdAt: { gte: since } }, _count: { _all: true },
      }),
      options.database.aIEvaluationRun.findMany({
        where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" }, take: 20,
        include: { useCaseVersion: { select: { key: true, version: true, name: true } } },
      }),
    ]);
    const totalExecutions = executions.reduce((total, item) => total + item._count._all, 0);
    const successful = executions.filter((item) => item.status === "SUCCEEDED" || item.status === "FALLBACK")
      .reduce((total, item) => total + item._count._all, 0);
    return {
      mode: "LOCAL_DETERMINISTIC" as const,
      externalProviderEnabled: false,
      copilot: {
        externalProviderEnabled: process.env.COPILOT_EXTERNAL_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY?.trim()) && Boolean(process.env.OPENAI_MODEL?.trim()),
        model: process.env.OPENAI_MODEL?.trim() || null,
        requiresExplicitSaleConfirmation: true,
      },
      period: { from: since.toISOString(), to: now().toISOString(), timeZone: workspace.timeZone },
      versions: versions.map((version) => ({
        id: version.id, key: version.key, version: version.version, name: version.name,
        description: version.description, riskLevel: version.riskLevel, status: version.status,
        provider: version.logicalProviderKey, model: version.logicalModel,
        prompt: `${version.promptKey}@${version.promptVersion}`,
        owner: version.owner.user.displayName,
        confidenceThresholdBps: version.confidenceThresholdBps,
        limits: { timeoutMs: version.timeoutMs, maxRetries: version.maxRetries, rateLimitPerMinute: version.rateLimitPerMinute, maxInputTokens: version.maxInputTokens, maxOutputTokens: version.maxOutputTokens, maxEstimatedCostCents: version.maxEstimatedCostCents },
        latestEvaluation: version.evaluationRuns[0] ? { status: version.evaluationRuns[0].status, passed: version.evaluationRuns[0].passedCases, failed: version.evaluationRuns[0].failedCases, createdAt: version.evaluationRuns[0].createdAt.toISOString() } : null,
        approvedBy: version.approvedBy?.displayName ?? null,
        approvedAt: version.approvedAt?.toISOString() ?? null,
        approvalReason: version.approvalReason,
      })),
      observability: {
        totalExecutions,
        successfulExecutions: successful,
        failureExecutions: executions.filter((item) => item.status === "FAILED" || item.status === "REJECTED").reduce((total, item) => total + item._count._all, 0),
        fallbackExecutions: executions.find((item) => item.status === "FALLBACK")?._count._all ?? 0,
        successRateBps: totalExecutions === 0 ? null : Math.round((successful / totalExecutions) * 10_000),
        averageDurationMs: totalExecutions === 0 ? null : Math.round(executions.reduce((sum, item) => sum + Number(item._avg.durationMs ?? 0) * item._count._all, 0) / totalExecutions),
        decisions: Object.fromEntries(decisions.map((item) => [item.decision, item._count._all])),
        alerts: [
          ...(executions.some((item) => item.status === "FAILED") ? ["Há execuções de IA com falha nos últimos 30 dias."] : []),
          ...(versions.some((version) => version.status === "DRAFT") ? ["Há versões em rascunho aguardando avaliação."] : []),
        ],
      },
      evaluations: evaluations.map((evaluation) => ({
        id: evaluation.id, useCase: evaluation.useCaseVersion.name,
        version: evaluation.useCaseVersion.version, status: evaluation.status,
        total: evaluation.totalCases, passed: evaluation.passedCases, failed: evaluation.failedCases,
        dataset: `${evaluation.datasetKey}@${evaluation.datasetVersion}`,
        createdAt: evaluation.createdAt.toISOString(),
      })),
    };
  }

  async function runEvaluation(context: AuthenticatedContext, useCaseVersionId: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_EVALUATIONS_RUN, workspaceResource(context));
    const version = await options.database.aIUseCaseVersion.findFirst({ where: { id: useCaseVersionId, workspaceId: context.workspaceId } });
    if (!version) invalid("Versão de IA não encontrada.", "AI_USE_CASE_NOT_FOUND");
    if (version.status === "DISABLED") invalid("Versão desabilitada não pode ser avaliada.");
    const startedAt = performance.now();
    const report = await runLocalAIEvaluation();
    const completedAt = now();
    const created = await options.database.$transaction(async (tx) => {
      const run = await tx.aIEvaluationRun.create({
        data: {
          workspaceId: context.workspaceId, useCaseVersionId: version.id,
          datasetKey: AI_EVALUATION_DATASET_KEY, datasetVersion: AI_EVALUATION_DATASET_VERSION,
          status: report.passed ? "PASSED" : "FAILED", totalCases: report.results.length,
          passedCases: report.results.filter((item) => item.passed).length,
          failedCases: report.results.filter((item) => !item.passed).length,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)), inputFingerprint: report.inputFingerprint,
          createdByActorId: context.actorId, completedAt,
          results: { create: report.results.map((item) => ({
            caseKey: item.key, category: item.category,
            passed: item.passed, reasonCode: item.expectedReasonCode,
            safeEvidence: { datasetVersion: AI_EVALUATION_DATASET_VERSION, containsPayload: false }, durationMs: item.durationMs,
          })) },
        },
      });
      if (report.passed && version.status === "DRAFT") {
        await tx.aIUseCaseVersion.update({ where: { id: version.id }, data: { status: "EVALUATED" } });
        await tx.aIGovernanceEvent.create({ data: { workspaceId: context.workspaceId, useCaseVersionId: version.id, fromStatus: "DRAFT", toStatus: "EVALUATED", reason: "Avaliação local determinística concluída sem falhas.", createdByActorId: context.actorId } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.evaluation.completed", origin: "DOMAIN", entityType: "AIEvaluationRun", entityId: run.id, changes: { after: { status: run.status, passedCases: run.passedCases, failedCases: run.failedCases } }, metadata: { useCaseVersionId: version.id, datasetVersion: AI_EVALUATION_DATASET_VERSION } } });
      return run;
    });
    return { id: created.id, status: created.status, passed: created.passedCases, failed: created.failedCases };
  }

  async function transition(context: AuthenticatedContext, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_GOVERNANCE_MANAGE, workspaceResource(context));
    const input = governanceTransitionSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-governance:${context.workspaceId}`}))`;
      const version = await tx.aIUseCaseVersion.findFirst({ where: { id: input.useCaseVersionId, workspaceId: context.workspaceId } });
      if (!version) invalid("Versão de IA não encontrada.", "AI_USE_CASE_NOT_FOUND");
      let toStatus = version.status;
      if (input.action === "APPROVE") {
        if (version.status !== "EVALUATED") invalid("A versão precisa passar pela avaliação antes da aprovação.");
        const passed = await tx.aIEvaluationRun.findFirst({ where: { workspaceId: context.workspaceId, useCaseVersionId: version.id, status: "PASSED" }, orderBy: { createdAt: "desc" } });
        if (!passed) invalid("Não existe avaliação aprovada para esta versão.");
        await tx.aIUseCaseVersion.updateMany({ where: { workspaceId: context.workspaceId, key: version.key, status: "APPROVED", id: { not: version.id } }, data: { status: "DISABLED" } });
        toStatus = "APPROVED";
      } else if (input.action === "DISABLE") {
        if (version.status === "DISABLED") invalid("A versão já está desabilitada.");
        toStatus = "DISABLED";
      } else if (input.action === "ROLLBACK") {
        if (!input.rollbackTargetVersionId) invalid("Informe a versão de rollback.");
        const target = await tx.aIUseCaseVersion.findFirst({ where: { id: input.rollbackTargetVersionId, workspaceId: context.workspaceId, key: version.key } });
        if (!target || target.status === "DRAFT") invalid("A versão alvo não foi previamente avaliada.");
        await tx.aIUseCaseVersion.updateMany({ where: { workspaceId: context.workspaceId, key: version.key, status: "APPROVED" }, data: { status: "DISABLED" } });
        await tx.aIUseCaseVersion.update({ where: { id: target.id }, data: { status: "APPROVED", approvedByActorId: context.actorId, approvedAt: now(), approvalReason: input.reason } });
        await tx.aIGovernanceEvent.create({ data: { workspaceId: context.workspaceId, useCaseVersionId: target.id, fromStatus: target.status, toStatus: "APPROVED", reason: input.reason, rollbackTargetVersionId: target.id, createdByActorId: context.actorId } });
        toStatus = "DISABLED";
      } else {
        invalid("Use a execução de avaliação para mover uma versão a EVALUATED.");
      }
      const updated = await tx.aIUseCaseVersion.update({ where: { id: version.id }, data: { status: toStatus, ...(toStatus === "APPROVED" ? { approvedByActorId: context.actorId, approvedAt: now(), approvalReason: input.reason } : {}) } });
      await tx.aIGovernanceEvent.create({ data: { workspaceId: context.workspaceId, useCaseVersionId: version.id, fromStatus: version.status, toStatus, reason: input.reason, ...(input.rollbackTargetVersionId ? { rollbackTargetVersionId: input.rollbackTargetVersionId } : {}), createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `ai.governance.${input.action.toLowerCase()}`, origin: "DOMAIN", entityType: "AIUseCaseVersion", entityId: version.id, reason: input.reason, changes: { before: { status: version.status }, after: { status: toStatus } }, metadata: { key: version.key, version: version.version, rollbackTargetVersionId: input.rollbackTargetVersionId ?? null } } });
      return { id: updated.id, status: updated.status };
    });
  }

  async function recordHumanDecision(context: AuthenticatedContext, raw: unknown) {
    const input = humanDecisionInputSchema.parse(raw);
    const trace = await options.database.aIExecutionTrace.findFirst({ where: { id: input.executionTraceId, workspaceId: context.workspaceId, aiInsightId: input.insightId } });
    if (!trace) invalid("Execução de IA não encontrada.", "AI_EXECUTION_NOT_FOUND");
    const resource = trace.targetType === "LEAD"
      ? await options.database.lead.findFirst({
          where: { id: trace.targetId, workspaceId: context.workspaceId, deletedAt: null },
          select: { id: true, ownerMemberId: true, queueId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } },
        }).then((lead) => lead ? { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.ownerMemberId ? null : lead.queueId, teamId: lead.ownerMemberId ? null : lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null } : null)
      : trace.targetType === "OPPORTUNITY"
        ? await options.database.opportunity.findFirst({ where: { id: trace.targetId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, ownerMemberId: true } }).then((opportunity) => opportunity ? { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: opportunity.id, ownerMemberId: opportunity.ownerMemberId } : null)
        : workspaceResource(context);
    if (!resource) invalid("Alvo da execução não está mais disponível.", "AI_EXECUTION_TARGET_NOT_FOUND");
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource);
    const stale = trace.inputFingerprint !== input.currentInputFingerprint;
    const existing = await options.database.aIHumanDecision.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return { id: existing.id, decision: existing.decision, stale: existing.stale, applied: false as const };
    const created = await options.database.$transaction(async (tx) => {
      const decision = await tx.aIHumanDecision.create({ data: {
          workspaceId: context.workspaceId, executionTraceId: trace.id, aiInsightId: input.insightId,
          idempotencyKey: input.idempotencyKey, decision: stale ? "REJECTED" : input.decision,
          reason: stale ? "Sugestão expirada: os dados de origem mudaram desde a execução." : input.reason,
          ...(input.proposedDraft ? { proposedDraft: json(input.proposedDraft) } : {}),
          originalInputFingerprint: trace.inputFingerprint, currentInputFingerprint: input.currentInputFingerprint,
          stale, createdByActorId: context.actorId,
        } });
      await tx.auditLog.create({ data: {
        workspaceId: context.workspaceId, actorId: context.actorId,
        action: "ai.human_decision.recorded", origin: "DOMAIN", entityType: "AIHumanDecision", entityId: decision.id,
        reason: decision.reason, changes: { after: { decision: decision.decision, stale, applied: false } },
        metadata: { executionTraceId: trace.id, aiInsightId: input.insightId, inputFingerprintChanged: stale },
      } });
      return decision;
    });
    return { id: created.id, decision: created.decision, stale: created.stale, applied: false };
  }

  return Object.freeze({ getScreen, runEvaluation, transition, recordHumanDecision });
}

let service: ReturnType<typeof createAIGovernanceService> | undefined;
export function getAIGovernanceService() {
  service ??= createAIGovernanceService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
  return service;
}
