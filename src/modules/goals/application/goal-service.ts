import { Prisma, type GoalMetricKey, type GoalQuota, type OwnershipFunction, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createGoalPlanSchema, goalMetricCatalog, goalPeriodInstants, goalPlanActionSchema, goalProgress, goalQuerySchema, quotaTargetKey, resolveEffectiveQuota, updateGoalPlanSchema, type GoalProgressState, type GoalQuotaInput } from "@/modules/goals/domain/goal-contracts";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date };
const SERIALIZABLE_MAX_ATTEMPTS = 4;
const resource = (workspaceId: string, resourceId?: string, memberId?: string | null, teamId?: string | null) => ({ workspaceId, resourceType: "GoalPlan", ...(resourceId ? { resourceId } : {}), ...(memberId !== undefined ? { memberId } : {}), ...(teamId !== undefined ? { teamId } : {}) });
function invalid(message: string, code = "INVALID_GOAL_PLAN"): never { throw new ApplicationError(message, { code, statusCode: 400, expose: true }); }
function notFound(): never { throw new ApplicationError("Plano de metas não encontrado.", { code: "GOAL_PLAN_NOT_FOUND", statusCode: 404, expose: true }); }
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function withSerializableRetry<T>(database: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === SERIALIZABLE_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("Limite de tentativas serializáveis atingido.");
}

function drilldown(metricKey: GoalMetricKey, memberIds: readonly string[], from: Date, to: Date) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (memberIds.length === 1) params.set("ownerMemberId", memberIds[0]!);
  if (metricKey === "MEETINGS_HELD") return `/agenda?${params}`;
  if (["OPPORTUNITIES_WON", "REVENUE_WON_CENTS", "NEW_MRR_CENTS"].includes(metricKey)) return `/oportunidades?${params}`;
  if (metricKey === "EXPANSION_MRR_CENTS" || metricKey === "RENEWALS_COMPLETED") return `/farmer?${params}`;
  return `/leads?${params}`;
}

export function createGoalService(options: Options) {
  async function authorize(context: AuthenticatedContext, permission: PermissionKey, planId?: string) {
    return options.authorization.assertAuthorized(context, permission, resource(context.workspaceId, planId, context.memberId));
  }
  async function lock(tx: Prisma.TransactionClient, workspaceId: string, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm55:${workspaceId}:${key}`}))`;
  }
  async function targetLabels(database: Prisma.TransactionClient | PrismaClient, workspaceId: string, quotas: readonly GoalQuotaInput[]) {
    const memberIds = quotas.flatMap((quota) => quota.memberId ? [quota.memberId] : []);
    const teamIds = quotas.flatMap((quota) => quota.teamId ? [quota.teamId] : []);
    const [members, teams] = await Promise.all([
      database.workspaceMember.findMany({ where: { workspaceId, id: { in: memberIds }, deletedAt: null }, select: { id: true, user: { select: { displayName: true } } } }),
      database.team.findMany({ where: { workspaceId, id: { in: teamIds }, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    if (members.length !== new Set(memberIds).size || teams.length !== new Set(teamIds).size) invalid("Uma pessoa ou equipe não pertence ao workspace.");
    const seen = new Set<string>();
    return quotas.map((quota) => {
      const key = `${quota.metricKey}:${quotaTargetKey(quota)}`;
      if (seen.has(key)) invalid("A mesma métrica não pode ter duas quotas para o mesmo alvo.");
      seen.add(key);
      const label = quota.memberId ? members.find((item) => item.id === quota.memberId)?.user.displayName : quota.teamId ? teams.find((item) => item.id === quota.teamId)?.name : quota.function;
      return { ...quota, targetLabel: label ?? quota.targetLabel, targetKey: quotaTargetKey(quota), currency: quota.unit === "CURRENCY_CENTS" ? "BRL" as const : null };
    });
  }
  async function appendEvent(tx: Prisma.TransactionClient, input: { workspaceId: string; planId: string; type: "DRAFT_CREATED" | "DRAFT_UPDATED" | "PUBLISHED" | "SUPERSEDED" | "RETIRED"; reason: string; actorId: string; idempotencyKey: string; snapshot: unknown }) {
    const sequence = (await tx.goalPlanEvent.aggregate({ where: { workspaceId: input.workspaceId, planId: input.planId }, _max: { sequence: true } }))._max.sequence ?? 0;
    await tx.goalPlanEvent.create({ data: { workspaceId: input.workspaceId, planId: input.planId, sequence: sequence + 1, type: input.type, reason: input.reason, snapshot: json(input.snapshot), actorId: input.actorId, idempotencyKey: input.idempotencyKey, occurredAt: options.now() } });
  }
  async function createDraft(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.GOALS_MANAGE);
    const input = createGoalPlanSchema.parse(raw);
    const workspace = await options.database.workspace.findUnique({ where: { id: context.workspaceId }, select: { timeZone: true } });
    if (!workspace) notFound();
    const period = goalPeriodInstants(input.periodStartDate, input.periodEndDate, workspace.timeZone);
    const quotas = await targetLabels(options.database, context.workspaceId, input.quotas);
    return withSerializableRetry(options.database, async (tx) => {
      await lock(tx, context.workspaceId, `plan:${input.key}`);
      const replay = await tx.goalPlan.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } }, include: { quotas: true } });
      if (replay) return replay;
      const latest = await tx.goalPlan.findFirst({ where: { workspaceId: context.workspaceId, key: input.key }, orderBy: { version: "desc" }, select: { version: true } });
      const now = options.now();
      const plan = await tx.goalPlan.create({ data: { workspaceId: context.workspaceId, key: input.key, version: (latest?.version ?? 0) + 1, name: input.name, description: input.description ?? null, periodStart: period.start, periodEnd: period.end, timeZone: workspace.timeZone, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now, quotas: { create: quotas.map((quota) => ({ targetType: quota.targetType, targetKey: quota.targetKey, memberId: quota.memberId ?? null, teamId: quota.teamId ?? null, function: quota.function ?? null, metricKey: quota.metricKey, unit: quota.unit, targetValue: quota.targetValue, currency: quota.currency, targetLabel: quota.targetLabel, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now })) } }, include: { quotas: true } });
      await appendEvent(tx, { workspaceId: context.workspaceId, planId: plan.id, type: "DRAFT_CREATED", reason: "Rascunho criado pelo editor de metas.", actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:event`, snapshot: { key: plan.key, version: plan.version, periodStart: plan.periodStart.toISOString(), periodEnd: plan.periodEnd.toISOString(), quotaCount: quotas.length } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.plan.created", entityType: "GoalPlan", entityId: plan.id, changes: { key: plan.key, version: plan.version, status: plan.status }, metadata: { idempotencyKey: input.idempotencyKey } } });
      return plan;
    });
  }
  async function updateDraft(context: AuthenticatedContext, planId: string, raw: unknown) {
    await authorize(context, PermissionKeys.GOALS_MANAGE, planId);
    const input = updateGoalPlanSchema.parse(raw);
    const current = await options.database.goalPlan.findFirst({ where: { id: planId, workspaceId: context.workspaceId }, select: { key: true, timeZone: true } });
    if (!current) notFound();
    const period = goalPeriodInstants(input.periodStartDate, input.periodEndDate, current.timeZone);
    const quotas = await targetLabels(options.database, context.workspaceId, input.quotas);
    return withSerializableRetry(options.database, async (tx) => {
      await lock(tx, context.workspaceId, `plan:${current.key}`);
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "goals.plan.updated", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
      if (replay) return tx.goalPlan.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: planId }, include: { quotas: true } });
      const plan = await tx.goalPlan.findFirst({ where: { id: planId, workspaceId: context.workspaceId } });
      if (!plan) notFound();
      if (plan.status !== "DRAFT") invalid("Somente rascunhos podem ser editados; crie uma nova versão.");
      if (plan.revision !== input.expectedRevision) invalid("O plano foi alterado por outra pessoa. Recarregue antes de salvar.", "GOAL_PLAN_CONFLICT");
      await tx.goalQuota.deleteMany({ where: { workspaceId: context.workspaceId, planId } });
      const now = options.now();
      const updated = await tx.goalPlan.update({ where: { id: planId }, data: { name: input.name, description: input.description ?? null, periodStart: period.start, periodEnd: period.end, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: now, quotas: { create: quotas.map((quota) => ({ targetType: quota.targetType, targetKey: quota.targetKey, memberId: quota.memberId ?? null, teamId: quota.teamId ?? null, function: quota.function ?? null, metricKey: quota.metricKey, unit: quota.unit, targetValue: quota.targetValue, currency: quota.currency, targetLabel: quota.targetLabel, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now })) } }, include: { quotas: true } });
      await appendEvent(tx, { workspaceId: context.workspaceId, planId, type: "DRAFT_UPDATED", reason: "Rascunho revisado antes da publicação.", actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:event`, snapshot: { revision: updated.revision, quotaCount: quotas.length } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.plan.updated", entityType: "GoalPlan", entityId: planId, changes: { revision: updated.revision }, metadata: { idempotencyKey: input.idempotencyKey } } });
      return updated;
    });
  }
  async function act(context: AuthenticatedContext, planId: string, raw: unknown) {
    const input = goalPlanActionSchema.parse(raw);
    await authorize(context, input.action === "CREATE_VERSION" ? PermissionKeys.GOALS_MANAGE : PermissionKeys.GOALS_PUBLISH, planId);
    return withSerializableRetry(options.database, async (tx) => {
      const found = await tx.goalPlan.findFirst({ where: { id: planId, workspaceId: context.workspaceId }, include: { quotas: true } });
      if (!found) notFound();
      await lock(tx, context.workspaceId, `plan:${found.key}`);
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: `goals.plan.${input.action.toLowerCase()}`, metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
      if (replay) return tx.goalPlan.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: String((replay.changes as { planId?: string })?.planId ?? planId) }, include: { quotas: true } });
      if (found.revision !== input.expectedRevision) invalid("O plano foi alterado por outra pessoa. Recarregue antes de continuar.", "GOAL_PLAN_CONFLICT");
      const now = options.now();
      if (input.action === "CREATE_VERSION") {
        if (found.status === "DRAFT") invalid("Publique o rascunho atual antes de criar uma versão substituta.");
        const latest = await tx.goalPlan.findFirst({ where: { workspaceId: context.workspaceId, key: found.key }, orderBy: { version: "desc" }, select: { version: true } });
        const created = await tx.goalPlan.create({ data: { workspaceId: context.workspaceId, key: found.key, version: (latest?.version ?? found.version) + 1, name: found.name, description: found.description, periodStart: found.periodStart, periodEnd: found.periodEnd, timeZone: found.timeZone, supersedesPlanId: found.id, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now, quotas: { create: found.quotas.map((quota) => ({ targetType: quota.targetType, targetKey: quota.targetKey, memberId: quota.memberId, teamId: quota.teamId, function: quota.function, metricKey: quota.metricKey, unit: quota.unit, targetValue: quota.targetValue, currency: quota.currency, targetLabel: quota.targetLabel, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now })) } }, include: { quotas: true } });
        await appendEvent(tx, { workspaceId: context.workspaceId, planId: created.id, type: "DRAFT_CREATED", reason: input.reason, actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:event`, snapshot: { supersedesPlanId: found.id, version: created.version } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.plan.create_version", entityType: "GoalPlan", entityId: created.id, changes: { planId: created.id, supersedesPlanId: found.id }, metadata: { idempotencyKey: input.idempotencyKey } } });
        return created;
      }
      if (input.action === "PUBLISH") {
        if (found.status !== "DRAFT" || found.quotas.length === 0) invalid("Somente rascunho completo pode ser publicado.");
        const prior = await tx.goalPlan.findFirst({ where: { workspaceId: context.workspaceId, key: found.key, status: "PUBLISHED", id: { not: found.id } } });
        if (prior) {
          await tx.goalPlan.update({ where: { id: prior.id }, data: { status: "RETIRED", retiredAt: now, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: now } });
          await appendEvent(tx, { workspaceId: context.workspaceId, planId: prior.id, type: "SUPERSEDED", reason: input.reason, actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:superseded`, snapshot: { supersededByPlanId: found.id } });
        }
        const published = await tx.goalPlan.update({ where: { id: found.id }, data: { status: "PUBLISHED", publishedAt: now, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: now }, include: { quotas: true } });
        await appendEvent(tx, { workspaceId: context.workspaceId, planId: found.id, type: "PUBLISHED", reason: input.reason, actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:event`, snapshot: { version: found.version, quotaCount: found.quotas.length } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.plan.publish", entityType: "GoalPlan", entityId: found.id, changes: { planId: found.id, status: "PUBLISHED" }, metadata: { idempotencyKey: input.idempotencyKey } } });
        return published;
      }
      if (found.status !== "PUBLISHED") invalid("Somente plano publicado pode ser retirado.");
      const retired = await tx.goalPlan.update({ where: { id: found.id }, data: { status: "RETIRED", retiredAt: now, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: now }, include: { quotas: true } });
      await appendEvent(tx, { workspaceId: context.workspaceId, planId: found.id, type: "RETIRED", reason: input.reason, actorId: context.actorId, idempotencyKey: `${input.idempotencyKey}:event`, snapshot: { version: found.version } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.plan.retire", entityType: "GoalPlan", entityId: found.id, changes: { planId: found.id, status: "RETIRED" }, metadata: { idempotencyKey: input.idempotencyKey } } });
      return retired;
    });
  }

  async function memberIdsForQuota(workspaceId: string, quota: GoalQuota): Promise<string[]> {
    if (quota.memberId) return [quota.memberId];
    if (quota.teamId) return (await options.database.teamMember.findMany({ where: { workspaceId, teamId: quota.teamId, deletedAt: null, member: { status: "ACTIVE", deletedAt: null } }, select: { workspaceMemberId: true } })).map((item) => item.workspaceMemberId);
    const ownership = await options.database.ownershipAssignment.findMany({ where: { workspaceId, ...(quota.function ? { function: quota.function } : {}), status: "ACTIVE", memberId: { not: null } }, distinct: ["memberId"], select: { memberId: true } });
    const ids = ownership.flatMap((item) => item.memberId ? [item.memberId] : []);
    if (quota.function === "SDR" || quota.function === "CLOSER") {
      const team = await options.database.teamMember.findMany({ where: { workspaceId, function: quota.function, deletedAt: null }, distinct: ["workspaceMemberId"], select: { workspaceMemberId: true } });
      ids.push(...team.map((item) => item.workspaceMemberId));
    }
    return [...new Set(ids)];
  }
  async function actual(workspaceId: string, quota: GoalQuota, periodStart: Date, periodEnd: Date, asOf: Date) {
    const to = asOf < periodEnd ? asOf : periodEnd;
    const memberIds = await memberIdsForQuota(workspaceId, quota);
    if (to <= periodStart) return { value: 0n, state: "ZERO" as GoalProgressState, evidenceCount: 0, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    if (memberIds.length === 0) return { value: null, state: "PARTIAL" as GoalProgressState, evidenceCount: 0, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    const interval = { gte: periodStart, lt: to };
    if (quota.metricKey === "LEADS_ASSIGNED") {
      const rows = await options.database.lead.findMany({ where: { workspaceId, ownerMemberId: { in: memberIds }, createdAt: interval, deletedAt: null }, select: { id: true } });
      return { value: BigInt(rows.length), state: rows.length ? "VALUE" as const : "ZERO" as const, evidenceCount: rows.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    }
    if (quota.metricKey === "HUMAN_ATTEMPTS") {
      const users = await options.database.workspaceMember.findMany({ where: { workspaceId, id: { in: memberIds } }, select: { userId: true } });
      const actors = await options.database.actor.findMany({ where: { workspaceId, type: "HUMAN", userId: { in: users.map((item) => item.userId) } }, select: { id: true } });
      const count = await options.database.activity.count({ where: { workspaceId, createdByActorId: { in: actors.map((item) => item.id) }, occurredAt: interval, deletedAt: null, type: { in: ["CALL", "CALL_CONNECTED", "CALL_UNANSWERED", "MESSAGE_SENT", "EMAIL"] } } });
      return { value: BigInt(count), state: count ? "VALUE" as const : "ZERO" as const, evidenceCount: count, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    }
    if (quota.metricKey === "MEETINGS_HELD") {
      const count = await options.database.meeting.count({ where: { workspaceId, ownerMemberId: { in: memberIds }, status: "COMPLETED", completedAt: interval, deletedAt: null } });
      return { value: BigInt(count), state: count ? "VALUE" as const : "ZERO" as const, evidenceCount: count, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    }
    if (["OPPORTUNITIES_WON", "REVENUE_WON_CENTS", "NEW_MRR_CENTS", "LEAD_TO_SALE_BPS"].includes(quota.metricKey)) {
      const won = await options.database.opportunity.findMany({ where: { workspaceId, ownerMemberId: { in: memberIds }, status: "WON", closedAt: interval, deletedAt: null }, select: { id: true, leadId: true, amountCents: true, mrrCents: true } });
      if (quota.metricKey === "OPPORTUNITIES_WON") return { value: BigInt(won.length), state: won.length ? "VALUE" as const : "ZERO" as const, evidenceCount: won.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
      if (quota.metricKey === "REVENUE_WON_CENTS") return { value: won.reduce((sum, item) => sum + item.amountCents, 0n), state: won.length ? "VALUE" as const : "ZERO" as const, evidenceCount: won.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
      if (quota.metricKey === "NEW_MRR_CENTS") return { value: won.reduce((sum, item) => sum + item.mrrCents, 0n), state: won.length ? "VALUE" as const : "ZERO" as const, evidenceCount: won.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
      const leads = await options.database.lead.count({ where: { workspaceId, ownerMemberId: { in: memberIds }, createdAt: interval, deletedAt: null } });
      if (leads === 0) return { value: null, state: "NO_DENOMINATOR" as const, evidenceCount: 0, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
      return { value: BigInt(Math.round((new Set(won.map((item) => item.leadId)).size / leads) * 10_000)), state: won.length ? "VALUE" as const : "ZERO" as const, evidenceCount: won.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    }
    if (quota.metricKey === "RENEWALS_COMPLETED") {
      const count = await options.database.renewal.count({ where: { workspaceId, ownerMemberId: { in: memberIds }, status: { in: ["RENEWED", "NOT_RENEWED", "CANCELLED"] }, decidedAt: interval } });
      return { value: BigInt(count), state: count ? "VALUE" as const : "ZERO" as const, evidenceCount: count, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    }
    const assignments = await options.database.ownershipAssignment.findMany({ where: { workspaceId, memberId: { in: memberIds }, accountId: { not: null }, status: "ACTIVE" }, distinct: ["accountId"], select: { accountId: true } });
    const accountIds = assignments.flatMap((item) => item.accountId ? [item.accountId] : []);
    if (accountIds.length === 0) return { value: null, state: "PARTIAL" as const, evidenceCount: 0, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
    const movements = await options.database.revenueMovement.findMany({ where: { workspaceId, accountId: { in: accountIds }, type: "EXPANSION", effectiveAt: interval, deltaMrrCents: { gt: 0 } }, select: { id: true, deltaMrrCents: true } });
    return { value: movements.reduce((sum, item) => sum + item.deltaMrrCents, 0n), state: movements.length ? "VALUE" as const : "ZERO" as const, evidenceCount: movements.length, href: drilldown(quota.metricKey, memberIds, periodStart, to) };
  }
  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    const query = goalQuerySchema.parse(raw);
    const decision = await options.authorization.authorize(context, PermissionKeys.GOALS_READ, resource(context.workspaceId, undefined, context.memberId));
    if (!decision.allowed) {
      await authorize(context, PermissionKeys.GOALS_READ);
      throw new Error("Autorização de metas negada sem erro explícito.");
    }
    const selectedMemberId = query.memberId ?? context.memberId;
    if (query.memberId && query.memberId !== context.memberId) {
      await options.authorization.assertAuthorized(context, PermissionKeys.GOALS_READ, resource(context.workspaceId, undefined, query.memberId));
    }
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const asOf = query.asOf ?? options.now();
    const plans = await options.database.goalPlan.findMany({ where: { workspaceId: context.workspaceId, ...(query.planId ? { id: query.planId } : {}) }, include: { quotas: true, events: { orderBy: { sequence: "desc" }, take: 10 } }, orderBy: [{ periodStart: "desc" }, { version: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
    const teamIds = (await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: selectedMemberId, deletedAt: null }, select: { teamId: true, function: true } }));
    const ownershipFunctions = (await options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, memberId: selectedMemberId, status: "ACTIVE" }, distinct: ["function"], select: { function: true } })).map((item) => item.function);
    const ownFunctions = [...new Set([...teamIds.map((item) => item.function === "SDR" || item.function === "CLOSER" ? item.function : null), ...ownershipFunctions].filter(Boolean))] as OwnershipFunction[];
    const allowedQuotas = plans.flatMap((plan) => plan.quotas.map((quota) => ({ plan, quota }))).filter(({ quota }) => decision.scope === "WORKSPACE" || quota.memberId === selectedMemberId || Boolean(quota.teamId && teamIds.some((team) => team.teamId === quota.teamId)) || Boolean(quota.function && ownFunctions.includes(quota.function)));
    const allowedPlanIds = new Set(allowedQuotas.map(({ plan }) => plan.id));
    const visiblePlans = decision.scope === "WORKSPACE" ? plans : plans.filter((plan) => allowedPlanIds.has(plan.id));
    const effectiveByPlanMetric = new Map<string, string>();
    for (const plan of plans) for (const metric of goalMetricCatalog) {
      const chosen = resolveEffectiveQuota(plan.quotas.filter((quota) => quota.metricKey === metric.key), { memberId: selectedMemberId, teamIds: teamIds.map((item) => item.teamId), functions: ownFunctions });
      if (chosen) effectiveByPlanMetric.set(`${plan.id}:${metric.key}`, chosen.id);
    }
    const progress = [];
    for (const { plan, quota } of allowedQuotas) {
      const computed = await actual(context.workspaceId, quota, plan.periodStart, plan.periodEnd, asOf);
      progress.push({ planId: plan.id, quotaId: quota.id, metricKey: quota.metricKey, metricLabel: goalMetricCatalog.find((item) => item.key === quota.metricKey)?.label ?? quota.metricKey, unit: quota.unit, targetType: quota.targetType, memberId: quota.memberId, teamId: quota.teamId, function: quota.function, targetLabel: quota.targetLabel, targetValue: quota.targetValue.toString(), isEffectiveForViewer: effectiveByPlanMetric.get(`${plan.id}:${quota.metricKey}`) === quota.id, precedence: "MEMBER > TEAM > FUNCTION", ...goalProgress(computed.value, quota.targetValue, computed.state), evidenceCount: computed.evidenceCount, drilldownHref: computed.href });
    }
    const can = async (key: PermissionKey) => (await options.authorization.authorize(context, key, resource(context.workspaceId, undefined, context.memberId))).allowed;
    const permissions = { manage: await can(PermissionKeys.GOALS_MANAGE), publish: await can(PermissionKeys.GOALS_PUBLISH), backfill: await can(PermissionKeys.GOALS_BACKFILL) };
    const [members, teams] = permissions.manage ? await Promise.all([
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } } }),
      options.database.team.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true } }),
    ]) : [[], []];
    return { generatedAt: options.now().toISOString(), asOf: asOf.toISOString(), timeZone: workspace.timeZone, catalog: goalMetricCatalog, plans: visiblePlans.map((plan) => ({ id: plan.id, key: plan.key, version: plan.version, name: plan.name, description: plan.description, periodStart: plan.periodStart.toISOString(), periodEnd: plan.periodEnd.toISOString(), timeZone: plan.timeZone, status: plan.status, supersedesPlanId: plan.supersedesPlanId, publishedAt: plan.publishedAt?.toISOString() ?? null, retiredAt: plan.retiredAt?.toISOString() ?? null, revision: plan.revision, quotaCount: plan.quotas.length, events: plan.events.map((event) => ({ id: event.id, sequence: event.sequence, type: event.type, reason: event.reason, occurredAt: event.occurredAt.toISOString() })) })), progress, members: members.map((item) => ({ id: item.id, name: item.user.displayName })), teams, permissions, definitions: { period: "intervalo civil inclusivo na interface e [início, próximo dia após fim) no banco", precedence: "membro > equipe > função; somente uma quota efetiva por pessoa e métrica", asOf: "fatos com timestamp anterior ao corte; alterações futuras não reescrevem o resultado" } };
  }
  return Object.freeze({ screen, createDraft, updateDraft, act });
}

let singleton: ReturnType<typeof createGoalService> | undefined;
export function getGoalService() { singleton ??= createGoalService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
