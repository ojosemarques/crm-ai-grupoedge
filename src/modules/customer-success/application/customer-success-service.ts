import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPostSaleOperatingReviewService } from "@/modules/customer-success/application/post-sale-operating-review-service";
import {
  calculateCustomerHealth,
  customerSuccessQuerySchema,
  healthAssessmentSchema,
  nextPlanStatus,
  portfolioAssignmentSchema,
  successPlanActionSchema,
  successPlanSchema,
  type HealthEvidenceInput,
} from "@/modules/customer-success/domain/customer-success-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}
function resource(workspaceId: string, id?: string, ownerMemberId?: string | null, teamId?: string | null, queueId?: string | null) {
  return { workspaceId, resourceType: "CustomerSuccess", ...(id ? { resourceId: id } : {}), ...(ownerMemberId !== undefined ? { ownerMemberId } : {}), ...(teamId !== undefined ? { teamId } : {}), ...(queueId !== undefined ? { queueId } : {}) };
}
async function lockAccount(tx: Prisma.TransactionClient, workspaceId: string, accountId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:${accountId}`}))::text AS "lockResult"`);
}
async function appendEvent(tx: Prisma.TransactionClient, input: {
  workspaceId: string; accountId: string; actorId: string; type: "PORTFOLIO_ASSIGNED" | "PORTFOLIO_REASSIGNED" | "PLAN_CREATED" | "PLAN_ACTIVATED" | "PLAN_BLOCKED" | "PLAN_COMPLETED" | "PLAN_CANCELLED" | "MILESTONE_COMPLETED" | "HEALTH_ASSESSED" | "HEALTH_SUPERSEDED";
  idempotencyKey: string; newStatus: string; previousStatus?: string | null; reason: string; assignmentId?: string | null; planId?: string | null; milestoneId?: string | null; assessmentId?: string | null; safeMetadata?: Prisma.InputJsonValue;
}) {
  const latest = await tx.customerSuccessEvent.findFirst({ where: { workspaceId: input.workspaceId, accountId: input.accountId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return tx.customerSuccessEvent.create({ data: {
    workspaceId: input.workspaceId, accountId: input.accountId, actorId: input.actorId,
    type: input.type, idempotencyKey: input.idempotencyKey, newStatus: input.newStatus,
    reason: input.reason, sequence: (latest?.sequence ?? 0) + 1, occurredAt: new Date(),
    ...(input.previousStatus !== undefined ? { previousStatus: input.previousStatus } : {}),
    ...(input.assignmentId !== undefined ? { assignmentId: input.assignmentId } : {}),
    ...(input.planId !== undefined ? { planId: input.planId } : {}),
    ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
    ...(input.assessmentId !== undefined ? { assessmentId: input.assessmentId } : {}),
    ...(input.safeMetadata !== undefined ? { safeMetadata: input.safeMetadata } : {}),
  } });
}

export function createCustomerSuccessService(options: Options) {
  const operatingReviewService = createPostSaleOperatingReviewService(options);

  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    const query = customerSuccessQuerySchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_READ, resource(context.workspaceId, undefined, context.memberId));
    const where: Prisma.CustomerPortfolioAssignmentWhereInput = {
      workspaceId: context.workspaceId,
      ...(query.ownerMemberId ? { ownerMemberId: query.ownerMemberId } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.state ? { state: query.state } : { validTo: null }),
    };
    const candidates = await options.database.customerPortfolioAssignment.findMany({ where, orderBy: [{ priority: "asc" }, { nextActionAt: "asc" }, { accountId: "asc" }] });
    const visible = [];
    for (const item of candidates) {
      if ((await options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_READ, resource(context.workspaceId, item.accountId, item.ownerMemberId, item.teamId, item.queueId))).allowed) visible.push(item);
    }
    const accountIds = visible.map((item) => item.accountId);
    const [accounts, assessments, plans, members, teams, queues, canManage, canPlan, canAssess, canCorrect] = await Promise.all([
      options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: accountIds }, deletedAt: null }, select: { id: true, name: true, segment: true, status: true } }),
      options.database.customerHealthAssessment.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: accountIds } }, orderBy: [{ cutoffAt: "desc" }, { createdAt: "desc" }] }),
      options.database.successPlan.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: accountIds }, status: { in: ["DRAFT", "ACTIVE", "BLOCKED"] } } }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
      options.database.team.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      options.database.queue.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true, teamId: true }, orderBy: { name: "asc" } }),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_PORTFOLIO_MANAGE, resource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_PLAN_MANAGE, resource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_HEALTH_EVALUATE, resource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_CORRECT, resource(context.workspaceId, undefined, context.memberId)),
    ]);
    const latestHealth = new Map<string, typeof assessments[number]>();
    for (const assessment of assessments) if (!latestHealth.has(assessment.accountId)) latestHealth.set(assessment.accountId, assessment);
    const now = options.now();
    const healthFiltered = query.health ? visible.filter((item) => latestHealth.get(item.accountId)?.status === query.health) : visible;
    const filtered = query.overdue ? healthFiltered.filter((item) => item.nextActionAt && item.nextActionAt < now && item.state === "ACTIVE") : healthFiltered;
    const pageItems = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const accountMap = new Map(accounts.map((item) => [item.id, item]));
    const actualMilestones = await options.database.successPlanMilestone.findMany({ where: { workspaceId: context.workspaceId, planId: { in: plans.map((item) => item.id) } }, orderBy: [{ planId: "asc" }, { position: "asc" }] });
    const planMap = new Map(plans.map((item) => [item.accountId, { ...item, milestones: actualMilestones.filter((milestone) => milestone.planId === item.id) }]));
    const items = await Promise.all(pageItems.map(async (item) => ({
      ...item,
      account: accountMap.get(item.accountId)!,
      health: latestHealth.get(item.accountId) ?? null,
      plan: planMap.get(item.accountId) ?? null,
      operatingReview: await operatingReviewService.accountReview(context, item.accountId),
    })));
    return {
      generatedAt: now.toISOString(), timeZone: "America/Sao_Paulo", total: filtered.length, page: query.page, pageSize: query.pageSize,
      metrics: {
        active: visible.filter((item) => item.state === "ACTIVE").length,
        healthy: visible.filter((item) => latestHealth.get(item.accountId)?.status === "HEALTHY").length,
        attention: visible.filter((item) => latestHealth.get(item.accountId)?.status === "ATTENTION").length,
        risk: visible.filter((item) => latestHealth.get(item.accountId)?.status === "RISK").length,
        insufficient: visible.filter((item) => !latestHealth.has(item.accountId) || latestHealth.get(item.accountId)?.status === "INSUFFICIENT").length,
        overdue: visible.filter((item) => item.nextActionAt && item.nextActionAt < now && item.state === "ACTIVE").length,
      },
      formulas: { overdue: "state = ACTIVE e nextActionAt < instante de atualização", health: "pontuação ponderada da versão publicada; sinal obrigatório ausente ou vencido = dados insuficientes" },
      items, members: members.map((item) => ({ id: item.id, name: item.user.displayName })), teams, queues,
      permissions: { managePortfolio: canManage.allowed, managePlan: canPlan.allowed, assessHealth: canAssess.allowed, correct: canCorrect.allowed },
    };
  }

  async function assignPortfolio(context: AuthenticatedContext, raw: unknown) {
    const input = portfolioAssignmentSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_PORTFOLIO_MANAGE, resource(context.workspaceId, input.accountId, input.ownerMemberId, input.teamId, input.queueId));
    const execute = () => options.database.$transaction(async (tx) => {
      await lockAccount(tx, context.workspaceId, input.accountId);
      const existingByKey = await tx.customerPortfolioAssignment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existingByKey) return existingByKey;
      const account = await tx.account.findFirst({ where: { id: input.accountId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } });
      if (!account) fail("Conta ativa não encontrada.", "NOT_FOUND", 404);
      if (input.ownerMemberId && !(await tx.workspaceMember.findFirst({ where: { id: input.ownerMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } }))) fail("Responsável ativo não encontrado no workspace.");
      if (input.queueId && !(await tx.queue.findFirst({ where: { id: input.queueId, workspaceId: context.workspaceId, deletedAt: null } }))) fail("Fila não encontrada no workspace.");
      if (input.teamId && !(await tx.team.findFirst({ where: { id: input.teamId, workspaceId: context.workspaceId, deletedAt: null } }))) fail("Equipe não encontrada no workspace.");
      const current = await tx.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, validTo: null } });
      const at = options.now();
      if (current) await tx.customerPortfolioAssignment.update({ where: { id: current.id }, data: { validTo: at, state: "ENDED", endedByActorId: context.actorId, revision: { increment: 1 } } });
      const created = await tx.customerPortfolioAssignment.create({ data: { workspaceId: context.workspaceId, accountId: input.accountId, ownerMemberId: input.ownerMemberId ?? null, queueId: input.queueId ?? null, teamId: input.teamId ?? null, priority: input.priority, nextActionDescription: input.nextActionDescription, nextActionAt: input.nextActionAt, reason: input.reason, validFrom: at, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedAt: at } });
      await appendEvent(tx, { workspaceId: context.workspaceId, accountId: input.accountId, assignmentId: created.id, actorId: context.actorId, type: current ? "PORTFOLIO_REASSIGNED" : "PORTFOLIO_ASSIGNED", previousStatus: current?.state ?? null, newStatus: created.state, reason: input.reason, idempotencyKey: `${input.idempotencyKey}:event`, safeMetadata: { previousAssignmentId: current?.id ?? null, ownerMemberId: created.ownerMemberId, queueId: created.queueId, teamId: created.teamId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: current ? "customer_success.portfolio.reassigned" : "customer_success.portfolio.assigned", entityType: "CustomerPortfolioAssignment", entityId: created.id, reason: input.reason, changes: { previousAssignmentId: current?.id ?? null, accountId: input.accountId, ownerMemberId: created.ownerMemberId, queueId: created.queueId, nextActionAt: input.nextActionAt.toISOString() } } });
      return created;
    }, { isolationLevel: "Serializable" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await execute(); }
      catch (error) {
        const replay = await options.database.customerPortfolioAssignment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
        if (replay) return replay;
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
      }
    }
    throw new ApplicationError("A atribuição concorrente não pôde ser concluída.", { code: "CONCURRENT_ASSIGNMENT", statusCode: 409, expose: true });
  }

  async function createPlan(context: AuthenticatedContext, raw: unknown) {
    const input = successPlanSchema.parse(raw);
    const assignment = await options.database.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, validTo: null } });
    if (!assignment) fail("A conta precisa de atribuição de carteira ativa.", "PORTFOLIO_REQUIRED", 409);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_PLAN_MANAGE, resource(context.workspaceId, input.accountId, assignment.ownerMemberId, assignment.teamId, assignment.queueId));
    return options.database.$transaction(async (tx) => {
      await lockAccount(tx, context.workspaceId, input.accountId);
      const existing = await tx.successPlan.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
      if (await tx.successPlan.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, status: { in: ["DRAFT", "ACTIVE", "BLOCKED"] } } })) fail("A conta já possui um plano de sucesso aberto.", "OPEN_PLAN_EXISTS", 409);
      const template = await tx.successPlanTemplate.findFirst({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null, currentVersionId: { not: null } }, orderBy: { key: "asc" } });
      const version = template?.currentVersionId ? await tx.successPlanTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, id: template.currentVersionId, status: "PUBLISHED" } }) : null;
      const templateMilestones = version ? await tx.successPlanTemplateMilestone.findMany({ where: { workspaceId: context.workspaceId, templateVersionId: version.id }, orderBy: { position: "asc" } }) : [];
      const startsAt = options.now();
      if (input.targetAt <= startsAt || input.nextActionAt < startsAt) fail("Prazos do plano devem estar no futuro.");
      const plan = await tx.successPlan.create({ data: { workspaceId: context.workspaceId, accountId: input.accountId, assignmentId: assignment.id, templateVersionId: version?.id ?? null, ownerMemberId: assignment.ownerMemberId, queueId: assignment.queueId, title: input.title, objective: input.objective, startsAt, targetAt: input.targetAt, nextActionDescription: input.nextActionDescription, nextActionAt: input.nextActionAt, templateSnapshot: version ? { templateId: template!.id, templateKey: template!.key, version: version.version, objective: version.objective } : Prisma.JsonNull, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: startsAt } });
      if (templateMilestones.length) await tx.successPlanMilestone.createMany({ data: templateMilestones.map((item) => ({ workspaceId: context.workspaceId, planId: plan.id, key: item.key, name: item.name, position: item.position, required: item.required, dependencyKey: item.dependencyKey, dueAt: new Date(startsAt.getTime() + item.dueOffsetDays * 86_400_000), updatedAt: startsAt })) });
      await appendEvent(tx, { workspaceId: context.workspaceId, accountId: input.accountId, assignmentId: assignment.id, planId: plan.id, actorId: context.actorId, type: "PLAN_CREATED", newStatus: plan.status, reason: input.reason, idempotencyKey: `${input.idempotencyKey}:event`, safeMetadata: { templateVersionId: version?.id ?? null, milestoneCount: templateMilestones.length } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_success.plan.created", entityType: "SuccessPlan", entityId: plan.id, reason: input.reason, changes: { accountId: input.accountId, templateVersionId: version?.id ?? null, targetAt: plan.targetAt.toISOString() } } });
      return plan;
    }, { isolationLevel: "Serializable" });
  }

  async function actOnPlan(context: AuthenticatedContext, planId: string, raw: unknown) {
    const input = successPlanActionSchema.parse(raw);
    const current = await options.database.successPlan.findFirst({ where: { id: planId, workspaceId: context.workspaceId } });
    if (!current) fail("Plano não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_PLAN_MANAGE, resource(context.workspaceId, current.accountId, current.ownerMemberId, null, current.queueId));
    return options.database.$transaction(async (tx) => {
      await lockAccount(tx, context.workspaceId, current.accountId);
      if (await tx.customerSuccessEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: `${input.idempotencyKey}:event` } } })) return tx.successPlan.findUniqueOrThrow({ where: { id: planId } });
      if (input.action === "COMPLETE_MILESTONE") {
        if (!input.milestoneId || !input.evidence) fail("Marco e evidência são obrigatórios.");
        const milestone = await tx.successPlanMilestone.findFirst({ where: { id: input.milestoneId, workspaceId: context.workspaceId, planId } });
        if (!milestone) fail("Marco não encontrado.", "NOT_FOUND", 404);
        if (milestone.revision !== input.expectedRevision) fail("O marco foi alterado. Recarregue.", "REVISION_CONFLICT", 409);
        if (milestone.dependencyKey && !(await tx.successPlanMilestone.findFirst({ where: { workspaceId: context.workspaceId, planId, key: milestone.dependencyKey, status: "COMPLETED" } }))) fail("Conclua primeiro o marco dependente.", "DEPENDENCY_REQUIRED", 409);
        const at = options.now();
        await tx.successPlanMilestone.update({ where: { id: milestone.id }, data: { status: "COMPLETED", evidence: input.evidence, completedAt: at, completedByActorId: context.actorId, revision: { increment: 1 }, updatedAt: at } });
        await appendEvent(tx, { workspaceId: context.workspaceId, accountId: current.accountId, planId, milestoneId: milestone.id, actorId: context.actorId, type: "MILESTONE_COMPLETED", previousStatus: milestone.status, newStatus: "COMPLETED", reason: input.reason, idempotencyKey: `${input.idempotencyKey}:event`, safeMetadata: { evidence: input.evidence } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_success.milestone.completed", entityType: "SuccessPlanMilestone", entityId: milestone.id, reason: input.reason, changes: { planId, evidence: input.evidence } } });
        return tx.successPlan.findUniqueOrThrow({ where: { id: planId } });
      }
      const next = nextPlanStatus(current.status, input.action);
      if (!next) fail("Transição inválida para o estado atual.", "INVALID_TRANSITION", 409);
      if (input.action === "BLOCK" && !input.blockedReason) fail("Informe o bloqueio observado.");
      if (input.action === "COMPLETE") {
        const pendingRequired = await tx.successPlanMilestone.count({ where: { workspaceId: context.workspaceId, planId, required: true, status: { not: "COMPLETED" } } });
        if (pendingRequired) fail("Marcos obrigatórios ainda estão pendentes.", "MILESTONES_PENDING", 409);
      }
      const at = options.now();
      const updated = await tx.successPlan.updateMany({ where: { id: planId, workspaceId: context.workspaceId, revision: input.expectedRevision }, data: { status: next as "ACTIVE" | "BLOCKED" | "COMPLETED" | "CANCELLED", blockedReason: input.action === "BLOCK" ? input.blockedReason ?? null : null, completedAt: input.action === "COMPLETE" ? at : null, cancelledAt: input.action === "CANCEL" ? at : null, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
      if (!updated.count) fail("O plano foi alterado. Recarregue.", "REVISION_CONFLICT", 409);
      const eventType = { ACTIVATE: "PLAN_ACTIVATED", BLOCK: "PLAN_BLOCKED", UNBLOCK: "PLAN_ACTIVATED", COMPLETE: "PLAN_COMPLETED", CANCEL: "PLAN_CANCELLED" }[input.action] as "PLAN_ACTIVATED" | "PLAN_BLOCKED" | "PLAN_COMPLETED" | "PLAN_CANCELLED";
      await appendEvent(tx, { workspaceId: context.workspaceId, accountId: current.accountId, planId, actorId: context.actorId, type: eventType, previousStatus: current.status, newStatus: next, reason: input.reason, idempotencyKey: `${input.idempotencyKey}:event`, ...(input.blockedReason ? { safeMetadata: { blockedReason: input.blockedReason } } : {}) });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `customer_success.plan.${input.action.toLowerCase()}`, entityType: "SuccessPlan", entityId: planId, reason: input.reason, changes: { before: current.status, after: next } } });
      return tx.successPlan.findUniqueOrThrow({ where: { id: planId } });
    }, { isolationLevel: "Serializable" });
  }

  async function assessHealth(context: AuthenticatedContext, raw: unknown) {
    const input = healthAssessmentSchema.parse(raw);
    const assignment = await options.database.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, validTo: null } });
    if (!assignment) fail("Conta fora da carteira ativa.", "PORTFOLIO_REQUIRED", 409);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_HEALTH_EVALUATE, resource(context.workspaceId, input.accountId, assignment.ownerMemberId, assignment.teamId, assignment.queueId));
    return options.database.$transaction(async (tx) => {
      await lockAccount(tx, context.workspaceId, input.accountId);
      const existing = await tx.customerHealthAssessment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
      const cutoffAt = input.cutoffAt ?? options.now();
      const rule = await tx.customerHealthRuleVersion.findFirst({ where: { workspaceId: context.workspaceId, status: "PUBLISHED", effectiveFrom: { lte: cutoffAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: cutoffAt } }] }, orderBy: { version: "desc" } });
      if (!rule) fail("Nenhuma regra de saúde publicada está vigente.", "HEALTH_RULE_MISSING", 409);
      const definitions = await tx.customerHealthSignalDefinition.findMany({ where: { workspaceId: context.workspaceId, ruleVersionId: rule.id }, orderBy: { position: "asc" } });
      const [onboarding, plan, subscription] = await Promise.all([
        tx.onboardingCase.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, status: { in: ["ACTIVATED", "COMPLETED"] }, completedAt: { lte: cutoffAt } }, orderBy: { completedAt: "desc" } }),
        tx.successPlan.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, createdAt: { lte: cutoffAt } }, orderBy: { updatedAt: "desc" } }),
        tx.subscription.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, startsAt: { lte: cutoffAt } }, orderBy: { startsAt: "desc" } }),
      ]);
      const sourceByKey: Record<string, { value: number | null; at: Date | null; entityType: string; entityId: string | null; explanation: string }> = {
        ONBOARDING_COMPLETED: onboarding ? { value: 100, at: onboarding.completedAt ?? onboarding.activatedAt, entityType: "OnboardingCase", entityId: onboarding.id, explanation: "Onboarding concluído ou ativado com registro persistido." } : { value: null, at: null, entityType: "OnboardingCase", entityId: null, explanation: "Nenhum onboarding concluído foi encontrado até o corte." },
        SUCCESS_PLAN_ACTIVE: plan ? { value: ["ACTIVE", "COMPLETED"].includes(plan.status) ? 100 : 0, at: plan.updatedAt, entityType: "SuccessPlan", entityId: plan.id, explanation: `Plano persistido no estado ${plan.status}.` } : { value: null, at: null, entityType: "SuccessPlan", entityId: null, explanation: "Nenhum plano de sucesso foi encontrado até o corte." },
        NEXT_ACTION_ON_TIME: { value: assignment.nextActionAt ? (assignment.nextActionAt >= cutoffAt ? 100 : 0) : null, at: assignment.updatedAt, entityType: "CustomerPortfolioAssignment", entityId: assignment.id, explanation: assignment.nextActionAt ? "Prazo da próxima ação comparado ao corte." : "Próxima ação sem prazo persistido." },
        NO_ACTIVE_BLOCKER: { value: assignment.blockedReason || plan?.status === "BLOCKED" ? 0 : 100, at: plan?.updatedAt ?? assignment.updatedAt, entityType: plan ? "SuccessPlan" : "CustomerPortfolioAssignment", entityId: plan?.id ?? assignment.id, explanation: assignment.blockedReason || plan?.status === "BLOCKED" ? "Existe bloqueio operacional persistido." : "Nenhum bloqueio ativo foi registrado." },
        SUBSCRIPTION_ACTIVE: subscription ? { value: subscription.status === "ACTIVE" ? 100 : 0, at: subscription.updatedAt, entityType: "Subscription", entityId: subscription.id, explanation: `Assinatura persistida no estado ${subscription.status}.` } : { value: null, at: null, entityType: "Subscription", entityId: null, explanation: "Nenhuma assinatura foi encontrada até o corte." },
      };
      const evidence: HealthEvidenceInput[] = definitions.map((definition) => {
        const source = sourceByKey[definition.key] ?? { value: null, at: null, entityType: "UnsupportedSignal", entityId: null, explanation: "Sinal sem coletor determinístico nesta versão." };
        const ageMs = source.at ? cutoffAt.getTime() - source.at.getTime() : Number.POSITIVE_INFINITY;
        const freshness = source.value === null ? "MISSING" : ageMs > definition.freshnessDays * 86_400_000 ? "STALE" : "CURRENT";
        return { key: definition.key, weight: definition.weight, required: definition.required, direction: definition.direction, freshness, observedValue: source.value, explanation: source.explanation };
      });
      const result = calculateCustomerHealth(evidence, rule);
      const previous = await tx.customerHealthAssessment.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, cutoffAt: { lte: cutoffAt } }, orderBy: [{ cutoffAt: "desc" }, { createdAt: "desc" }] });
      const assessment = await tx.customerHealthAssessment.create({ data: { workspaceId: context.workspaceId, accountId: input.accountId, ruleVersionId: rule.id, cutoffAt, status: result.status, score: result.score, evidenceCount: evidence.filter((item) => item.freshness === "CURRENT").length, missingSignalCount: result.missingSignals.length, missingSignals: result.missingSignals as Prisma.InputJsonValue, formula: rule.formula, explanation: result.status === "INSUFFICIENT" ? "Dados obrigatórios ausentes ou vencidos; nenhuma nota foi inferida." : `Score ${result.score}/100 calculado pela regra v${rule.version}.`, supersedesId: previous?.id ?? null, idempotencyKey: input.idempotencyKey, assessedByActorId: context.actorId } });
      await tx.customerHealthEvidence.createMany({ data: definitions.map((definition, index) => { const source = sourceByKey[definition.key] ?? { value: null, at: null, entityType: "UnsupportedSignal", entityId: null, explanation: evidence[index]!.explanation }; return { workspaceId: context.workspaceId, assessmentId: assessment.id, signalDefinitionId: definition.id, sourceEntityType: source.entityType, sourceEntityId: source.entityId, factAt: source.at, observedValue: evidence[index]!.observedValue, present: evidence[index]!.observedValue !== null, freshness: evidence[index]!.freshness, explanation: evidence[index]!.explanation }; }) });
      if (previous) await appendEvent(tx, { workspaceId: context.workspaceId, accountId: input.accountId, assessmentId: assessment.id, actorId: context.actorId, type: "HEALTH_SUPERSEDED", previousStatus: previous.status, newStatus: assessment.status, reason: "Nova avaliação versionada preservou a anterior.", idempotencyKey: `${input.idempotencyKey}:supersedes`, safeMetadata: { supersedesId: previous.id } });
      await appendEvent(tx, { workspaceId: context.workspaceId, accountId: input.accountId, assessmentId: assessment.id, actorId: context.actorId, type: "HEALTH_ASSESSED", previousStatus: previous?.status ?? null, newStatus: assessment.status, reason: assessment.explanation, idempotencyKey: `${input.idempotencyKey}:event`, safeMetadata: { score: assessment.score, ruleVersion: rule.version, missingSignalCount: assessment.missingSignalCount } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_success.health.assessed", entityType: "CustomerHealthAssessment", entityId: assessment.id, reason: assessment.explanation, changes: { accountId: input.accountId, status: assessment.status, score: assessment.score, ruleVersion: rule.version, supersedesId: previous?.id ?? null } } });
      return assessment;
    }, { isolationLevel: "Serializable" });
  }

  return Object.freeze({ screen, assignPortfolio, createPlan, actOnPlan, assessHealth });
}

let service: ReturnType<typeof createCustomerSuccessService> | undefined;
export function getCustomerSuccessService() {
  service ??= createCustomerSuccessService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
