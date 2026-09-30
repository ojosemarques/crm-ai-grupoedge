import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { accountPlanCommandSchema, type AccountPlanCommand } from "@/modules/opportunities/domain/account-plan-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { cancelPendingOutboundForContactInTransaction } from "@/modules/privacy/application/privacy-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;
type CancellationEvent = "RESPONSE" | "OPT_OUT" | "WON" | "LOST";

function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

async function loadOpportunity(database: PrismaClient | Prisma.TransactionClient, workspaceId: string, opportunityId: string) {
  const row = await database.opportunity.findFirst({ where: { id: opportunityId, workspaceId, deletedAt: null }, select: { id: true, leadId: true, name: true, ownerMemberId: true, status: true, lead: { select: { sourceId: true, contactId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } } });
  if (!row) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
  return row;
}

async function authorize(options: Options, context: AuthenticatedContext, opportunityId: string, write: boolean) {
  const row = await loadOpportunity(options.database, context.workspaceId, opportunityId);
  const resource = { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: row.id, ownerMemberId: row.ownerMemberId, teamId: row.lead.routingQueue?.teamId ?? row.lead.queue?.teamId ?? null };
  const permission = write ? PermissionKeys.OPPORTUNITIES_WRITE : PermissionKeys.OPPORTUNITIES_READ;
  const decision = await options.authorization.authorize(context, permission, resource);
  if (!decision.allowed) await options.authorization.assertAuthorized(context, permission, resource);
  const scope = decision.allowed ? decision.scope : fail("Acesso negado.", "ACCESS_DENIED", 403);
  if (scope !== "WORKSPACE") {
    const memberships = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
    const rules = await options.database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId, sourceId: row.lead.sourceId }, select: { teamId: true, canRead: true, canTransition: true } });
    if (rules.length && !rules.some((rule) => memberships.some((membership) => membership.teamId === rule.teamId) && (write ? rule.canTransition : rule.canRead))) fail("A origem não permite esta ação para a equipe do vendedor.", "ORIGIN_TEAM_DENIED", 403);
  }
  return row;
}

async function validateOwner(tx: Prisma.TransactionClient, workspaceId: string, memberId: string | null) {
  if (!memberId) return;
  const exists = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { id: true } });
  if (!exists) fail("Responsável inválido ou inativo.", "INVALID_ACCOUNT_PLAN_OWNER", 422);
}

async function taskResponsibility(tx: Prisma.TransactionClient, workspaceId: string, memberId: string | null) {
  if (memberId) return { assigneeMemberId: memberId, queueId: null };
  const queue = await tx.queue.findFirst({ where: { workspaceId, isGeneral: true, deletedAt: null }, select: { id: true } });
  if (!queue) fail("Fila Geral não configurada para compromisso sem dono.", "GENERAL_QUEUE_REQUIRED", 422);
  return { assigneeMemberId: null, queueId: queue.id };
}

export async function cancelIncompatibleAccountPlanActionsInTransaction(tx: Prisma.TransactionClient, input: Readonly<{ workspaceId: string; opportunityId: string; actorId: string; at: Date; event: CancellationEvent }>) {
  const plan = await tx.opportunityAccountPlan.findUnique({ where: { workspaceId_opportunityId: { workspaceId: input.workspaceId, opportunityId: input.opportunityId } } });
  if (!plan) return { cancelledEpisodeIds: [], cancelledTrackIds: [], endedWaitIds: [], taskIds: [] };
  const onlyCustomerWait = input.event === "RESPONSE";
  const [episodes, tracks, waits] = await Promise.all([
    tx.opportunityPlanEpisode.findMany({ where: { workspaceId: input.workspaceId, accountPlanId: plan.id, status: "ACTIVE", ...(onlyCustomerWait ? { type: "CUSTOMER_WAIT" } : {}) }, select: { id: true, taskId: true } }),
    onlyCustomerWait ? Promise.resolve([]) : tx.opportunityPlanTrack.findMany({ where: { workspaceId: input.workspaceId, accountPlanId: plan.id, status: "ACTIVE" }, select: { id: true, taskId: true } }),
    tx.opportunityPlannedWait.findMany({ where: { workspaceId: input.workspaceId, accountPlanId: plan.id, status: "PLANNED" }, select: { id: true, taskId: true } }),
  ]);
  const taskIds = [...episodes.map((x) => x.taskId), ...tracks.map((x) => x.taskId), ...waits.map((x) => x.taskId)].filter((value): value is string => Boolean(value));
  if (taskIds.length) await tx.task.updateMany({ where: { workspaceId: input.workspaceId, opportunityId: input.opportunityId, id: { in: taskIds }, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED", result: `Encerrada por evento ${input.event}.`, updatedByActorId: input.actorId, updatedAt: input.at } });
  if (episodes.length) await tx.opportunityPlanEpisode.updateMany({ where: { workspaceId: input.workspaceId, id: { in: episodes.map((x) => x.id) } }, data: { status: "CANCELLED", cancelledAt: input.at, cancellationCode: input.event } });
  if (tracks.length) await tx.opportunityPlanTrack.updateMany({ where: { workspaceId: input.workspaceId, id: { in: tracks.map((x) => x.id) } }, data: { status: "CANCELLED", cancelledAt: input.at, cancellationCode: input.event } });
  if (waits.length) await tx.opportunityPlannedWait.updateMany({ where: { workspaceId: input.workspaceId, id: { in: waits.map((x) => x.id) } }, data: { status: input.event === "RESPONSE" ? "RESUMED" : "CANCELLED", endedAt: input.at, cancellationCode: input.event } });
  if (input.event === "RESPONSE" && waits.length) {
    const opportunity = await tx.opportunity.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.opportunityId }, select: { leadId: true, ownerMemberId: true } });
    let responseTask = await tx.task.findFirst({ where: { workspaceId: input.workspaceId, opportunityId: input.opportunityId, title: "Tratar resposta do cliente", status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: { createdAt: "desc" } });
    responseTask ??= await tx.task.create({ data: { workspaceId: input.workspaceId, leadId: opportunity.leadId, opportunityId: input.opportunityId, assigneeMemberId: opportunity.ownerMemberId, title: "Tratar resposta do cliente", description: "Retomar o programa consultivo após a resposta do cliente.", kind: "FOLLOW_UP", status: "OPEN", priority: "HIGH", dueAt: input.at, createdByActorId: input.actorId, updatedByActorId: input.actorId, createdAt: input.at, updatedAt: input.at } });
    await tx.opportunity.update({ where: { id: input.opportunityId }, data: { nextActionTaskId: responseTask.id, nextActionAt: responseTask.dueAt, nextActionDescription: responseTask.title, updatedByActorId: input.actorId, updatedAt: input.at } });
  }
  if (episodes.length || tracks.length || waits.length) await tx.opportunityAccountPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 }, updatedAt: input.at } });
  return { cancelledEpisodeIds: episodes.map((x) => x.id), cancelledTrackIds: tracks.map((x) => x.id), endedWaitIds: waits.map((x) => x.id), taskIds };
}

export async function cancelIncompatibleAccountPlanActionsForLeadInTransaction(tx: Prisma.TransactionClient, input: Readonly<{ workspaceId: string; leadId: string; actorId: string; at: Date; event: "RESPONSE" | "OPT_OUT" }>) {
  const opportunities = await tx.opportunity.findMany({ where: { workspaceId: input.workspaceId, leadId: input.leadId, status: "OPEN", deletedAt: null }, select: { id: true } });
  const results = [];
  for (const opportunity of opportunities) results.push(await cancelIncompatibleAccountPlanActionsInTransaction(tx, { workspaceId: input.workspaceId, opportunityId: opportunity.id, actorId: input.actorId, at: input.at, event: input.event }));
  return results;
}

function taskTitle(command: Extract<AccountPlanCommand, { action: "START_EPISODE" | "UPSERT_TRACK" }>) { return command.action === "START_EPISODE" ? command.title : `${command.type}: ${command.milestone}`; }

export function createAccountPlanService(options: Options) {
  async function getScreen(context: AuthenticatedContext, opportunityId: string) {
    await authorize(options, context, opportunityId, false);
    const plan = await options.database.opportunityAccountPlan.findUnique({ where: { workspaceId_opportunityId: { workspaceId: context.workspaceId, opportunityId } }, include: { episodes: { orderBy: [{ startedAt: "desc" }, { id: "asc" }] }, tracks: { orderBy: { type: "asc" } }, waits: { orderBy: { createdAt: "desc" } }, stakeholders: { orderBy: [{ startedAt: "desc" }, { id: "asc" }] } } });
    if (!plan) return { opportunityId, revision: 0, episodes: [], tracks: [], plannedWait: null, stakeholders: [] };
    const memberIds = [...new Set([...plan.episodes.map((x) => x.ownerMemberId), ...plan.tracks.map((x) => x.ownerMemberId), ...plan.waits.map((x) => x.ownerMemberId)].filter((x): x is string => Boolean(x)))];
    const members = await options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, id: { in: memberIds } }, select: { id: true, user: { select: { displayName: true } } } });
    const names = new Map(members.map((x) => [x.id, x.user.displayName]));
    const activeWait = plan.waits.find((x) => x.status === "PLANNED") ?? null;
    return {
      opportunityId, revision: plan.revision,
      episodes: plan.episodes.map((x) => ({ id: x.id, type: x.type, title: x.title, objective: x.objective, status: x.status, ownerMemberId: x.ownerMemberId, ownerName: x.ownerMemberId ? names.get(x.ownerMemberId) ?? null : null, dueAt: x.dueAt?.toISOString() ?? null, artifactUrl: x.artifactUrl, taskId: x.taskId, startedAt: x.startedAt.toISOString(), completedAt: x.completedAt?.toISOString() ?? null })),
      tracks: plan.tracks.map((x) => ({ id: x.id, type: x.type, milestone: x.milestone, artifactTitle: x.artifactTitle, artifactUrl: x.artifactUrl, status: x.status, ownerMemberId: x.ownerMemberId, ownerName: x.ownerMemberId ? names.get(x.ownerMemberId) ?? null : null, dueAt: x.dueAt.toISOString(), taskId: x.taskId, revision: x.revision })),
      plannedWait: activeWait ? { id: activeWait.id, reason: activeWait.reason, reviewAt: activeWait.reviewAt.toISOString(), ownerMemberId: activeWait.ownerMemberId, ownerName: names.get(activeWait.ownerMemberId) ?? null, taskId: activeWait.taskId, status: activeWait.status } : null,
      stakeholders: plan.stakeholders.map((x) => ({ id: x.id, name: x.name, role: x.role, isDecisionMaker: x.isDecisionMaker, status: x.status, startedAt: x.startedAt.toISOString(), endedAt: x.endedAt?.toISOString() ?? null })),
    };
  }

  async function command(context: AuthenticatedContext, opportunityId: string, raw: unknown) {
    const parsed = accountPlanCommandSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues.map((x) => x.message).join(" "), "INVALID_INPUT", 400);
    const opportunity = await authorize(options, context, opportunityId, true);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account-plan:${context.workspaceId}:${opportunityId}`}, 0))`;
      const replay = await tx.opportunityAccountPlanCommand.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay) {
        if (replay.opportunityId !== opportunityId || replay.action !== parsed.data.action) fail("A chave idempotente já pertence a outro comando.", "IDEMPOTENCY_KEY_REUSED", 409);
        return { ...(replay.result as Record<string, unknown>), idempotent: true };
      }
      let plan = await tx.opportunityAccountPlan.findUnique({ where: { workspaceId_opportunityId: { workspaceId: context.workspaceId, opportunityId } } });
      if (!plan) {
        if (parsed.data.expectedRevision !== 0) fail("O plano de conta mudou. Recarregue antes de continuar.", "ACCOUNT_PLAN_VERSION_CONFLICT");
        plan = await tx.opportunityAccountPlan.create({ data: { workspaceId: context.workspaceId, opportunityId } });
      } else if (plan.revision !== parsed.data.expectedRevision) fail("O plano de conta mudou. Recarregue antes de continuar.", "ACCOUNT_PLAN_VERSION_CONFLICT");
      const now = options.now();
      let result: Record<string, unknown>;
      if (parsed.data.action === "START_EPISODE") {
        await validateOwner(tx, context.workspaceId, parsed.data.ownerMemberId);
        const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
        const responsibility = await taskResponsibility(tx, context.workspaceId, parsed.data.ownerMemberId);
        const task = dueAt ? await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId, ...responsibility, title: parsed.data.title, description: parsed.data.objective, kind: "FOLLOW_UP", status: "OPEN", priority: "HIGH", dueAt, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: now, updatedAt: now } }) : null;
        const episode = await tx.opportunityPlanEpisode.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, type: parsed.data.type, title: parsed.data.title, objective: parsed.data.objective, artifactUrl: parsed.data.artifactUrl ?? null, ownerMemberId: parsed.data.ownerMemberId, taskId: task?.id ?? null, dueAt, startedAt: now } });
        result = { episodeId: episode.id };
      } else if (parsed.data.action === "UPSERT_TRACK") {
        await validateOwner(tx, context.workspaceId, parsed.data.ownerMemberId);
        const dueAt = new Date(parsed.data.dueAt);
        const responsibility = await taskResponsibility(tx, context.workspaceId, parsed.data.ownerMemberId);
        const current = await tx.opportunityPlanTrack.findUnique({ where: { workspaceId_accountPlanId_type: { workspaceId: context.workspaceId, accountPlanId: plan.id, type: parsed.data.type } } });
        let taskId = current?.taskId ?? null;
        if (taskId) await tx.task.update({ where: { id: taskId }, data: { ...responsibility, title: taskTitle(parsed.data), description: parsed.data.artifactTitle ?? parsed.data.milestone, dueAt, status: "OPEN", completedAt: null, result: null, updatedByActorId: context.actorId, updatedAt: now } });
        else taskId = (await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId, ...responsibility, title: taskTitle(parsed.data), description: parsed.data.artifactTitle ?? parsed.data.milestone, kind: "FOLLOW_UP", status: "OPEN", priority: "HIGH", dueAt, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: now, updatedAt: now } })).id;
        const revision = (current?.revision ?? 0) + 1;
        const track = current ? await tx.opportunityPlanTrack.update({ where: { id: current.id }, data: { milestone: parsed.data.milestone, artifactTitle: parsed.data.artifactTitle ?? null, artifactUrl: parsed.data.artifactUrl ?? null, ownerMemberId: parsed.data.ownerMemberId, taskId, dueAt, status: "ACTIVE", revision, completedAt: null, cancelledAt: null, cancellationCode: null, updatedAt: now } }) : await tx.opportunityPlanTrack.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, type: parsed.data.type, milestone: parsed.data.milestone, artifactTitle: parsed.data.artifactTitle ?? null, artifactUrl: parsed.data.artifactUrl ?? null, ownerMemberId: parsed.data.ownerMemberId, taskId, dueAt, revision } });
        await tx.opportunityPlanTrackRevision.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, trackId: track.id, revision, milestone: track.milestone, artifactTitle: track.artifactTitle, artifactUrl: track.artifactUrl, ownerMemberId: track.ownerMemberId, dueAt: track.dueAt, recordedAt: now } });
        result = { trackId: track.id, trackRevision: revision };
      } else if (parsed.data.action === "PLAN_WAIT") {
        await validateOwner(tx, context.workspaceId, parsed.data.ownerMemberId);
        const reviewAt = new Date(parsed.data.reviewAt);
        if (reviewAt <= now) fail("A revisão da espera deve estar no futuro.", "INVALID_REVIEW_AT", 422);
        const existing = await tx.opportunityPlannedWait.findMany({ where: { workspaceId: context.workspaceId, accountPlanId: plan.id, status: "PLANNED" }, select: { id: true, taskId: true } });
        if (existing.length) {
          await tx.task.updateMany({ where: { workspaceId: context.workspaceId, id: { in: existing.map((x) => x.taskId) }, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED", result: "Substituída por nova espera planejada.", updatedByActorId: context.actorId, updatedAt: now } });
          await tx.opportunityPlannedWait.updateMany({ where: { workspaceId: context.workspaceId, id: { in: existing.map((x) => x.id) } }, data: { status: "CANCELLED", endedAt: now, cancellationCode: "REPLACED" } });
        }
        const task = await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId, assigneeMemberId: parsed.data.ownerMemberId, title: "Retomar espera pactuada", description: parsed.data.reason, kind: "FOLLOW_UP", status: "OPEN", priority: "HIGH", dueAt: reviewAt, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: now, updatedAt: now } });
        const wait = await tx.opportunityPlannedWait.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, reason: parsed.data.reason, reviewAt, ownerMemberId: parsed.data.ownerMemberId, taskId: task.id } });
        await tx.opportunity.update({ where: { id: opportunityId }, data: { nextActionTaskId: task.id, nextActionAt: reviewAt, nextActionDescription: task.title, updatedByActorId: context.actorId, updatedAt: now } });
        result = { waitId: wait.id, reviewAt: reviewAt.toISOString() };
      } else if (parsed.data.action === "CHANGE_STAKEHOLDER") {
        if (parsed.data.replacesStakeholderId) {
          const old = await tx.opportunityPlanStakeholder.findFirst({ where: { id: parsed.data.replacesStakeholderId, workspaceId: context.workspaceId, accountPlanId: plan.id, status: "ACTIVE" } });
          if (!old) fail("Stakeholder anterior não está ativo neste plano.", "STAKEHOLDER_NOT_ACTIVE", 422);
          await tx.opportunityPlanStakeholder.update({ where: { id: old.id }, data: { status: "REPLACED", endedAt: now } });
        }
        const stakeholder = await tx.opportunityPlanStakeholder.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, name: parsed.data.name, role: parsed.data.role, isDecisionMaker: parsed.data.isDecisionMaker, replacesStakeholderId: parsed.data.replacesStakeholderId ?? null, startedAt: now } });
        result = { stakeholderId: stakeholder.id };
      } else if (parsed.data.action === "REGISTER_EVENT") {
        if (parsed.data.event === "OPT_OUT") {
          await tx.lead.update({ where: { id: opportunity.leadId }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: now, updatedByActorId: context.actorId } });
          if (opportunity.lead.contactId) {
            const point = await tx.contactPoint.findFirst({ where: { workspaceId: context.workspaceId, contactId: opportunity.lead.contactId, deletedAt: null }, orderBy: { isPrimary: "desc" } });
            if (point) await tx.contactPoint.updateMany({ where: { workspaceId: context.workspaceId, contactId: opportunity.lead.contactId, deletedAt: null }, data: { doNotContact: true, updatedByActorId: context.actorId } });
            await cancelPendingOutboundForContactInTransaction(tx, { workspaceId: context.workspaceId, contactId: opportunity.lead.contactId, contactPointId: point?.id ?? null, actorId: context.actorId, now, reasonCode: "ACCOUNT_PLAN_OPT_OUT" });
          }
        }
        const cancelled = await cancelIncompatibleAccountPlanActionsInTransaction(tx, { workspaceId: context.workspaceId, opportunityId, actorId: context.actorId, at: now, event: parsed.data.event });
        plan = await tx.opportunityAccountPlan.findUniqueOrThrow({ where: { id: plan.id } });
        result = { event: parsed.data.event, ...cancelled };
      } else {
        const { commitmentType, commitmentId, result: completionResult } = parsed.data;
        let taskId: string;
        if (commitmentType === "EPISODE") {
          const row = await tx.opportunityPlanEpisode.findFirst({ where: { id: commitmentId, workspaceId: context.workspaceId, accountPlanId: plan.id, status: "ACTIVE" } });
          if (!row) fail("Episódio ativo não encontrado.", "COMMITMENT_NOT_ACTIVE", 422);
          taskId = row.taskId ?? "";
          await tx.opportunityPlanEpisode.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: now } });
        } else if (commitmentType === "TRACK") {
          const row = await tx.opportunityPlanTrack.findFirst({ where: { id: commitmentId, workspaceId: context.workspaceId, accountPlanId: plan.id, status: "ACTIVE" } });
          if (!row) fail("Trilha ativa não encontrada.", "COMMITMENT_NOT_ACTIVE", 422);
          taskId = row.taskId ?? "";
          await tx.opportunityPlanTrack.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: now } });
        } else {
          const row = await tx.opportunityPlannedWait.findFirst({ where: { id: commitmentId, workspaceId: context.workspaceId, accountPlanId: plan.id, status: "PLANNED" } });
          if (!row) fail("Espera planejada ativa não encontrada.", "COMMITMENT_NOT_ACTIVE", 422);
          taskId = row.taskId;
          await tx.opportunityPlannedWait.update({ where: { id: row.id }, data: { status: "RESUMED", endedAt: now } });
        }
        if (taskId) await tx.task.updateMany({ where: { id: taskId, workspaceId: context.workspaceId, opportunityId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: now, result: completionResult, updatedByActorId: context.actorId, updatedAt: now } });
        result = { commitmentId, commitmentType };
      }
      if (parsed.data.action !== "REGISTER_EVENT") plan = await tx.opportunityAccountPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 }, updatedAt: now } });
      const response = { opportunityId, revision: plan.revision, ...result, idempotent: false };
      await tx.opportunityAccountPlanCommand.create({ data: { workspaceId: context.workspaceId, opportunityId, accountPlanId: plan.id, idempotencyKey: parsed.data.idempotencyKey, action: parsed.data.action, result: json(response) } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `opportunity.account_plan.${parsed.data.action.toLowerCase()}`, entityType: "Opportunity", entityId: opportunityId, requestId: parsed.data.idempotencyKey, changes: json(response) } });
      return response;
    });
  }

  async function getCommitments(context: AuthenticatedContext) {
    const decision = await options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_READ, { workspaceId: context.workspaceId, resourceType: "AccountPlanCommitment", ownerMemberId: context.memberId });
    if (!decision.allowed) await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_READ, { workspaceId: context.workspaceId, resourceType: "AccountPlanCommitment", ownerMemberId: context.memberId });
    const scope = decision.allowed ? decision.scope : fail("Acesso negado.", "ACCESS_DENIED", 403);
    let ownerIds: string[] | undefined;
    if (scope === "OWN") ownerIds = [context.memberId];
    if (scope === "TEAM") {
      const teams = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
      const members = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, teamId: { in: teams.map((x) => x.teamId) }, deletedAt: null }, select: { workspaceMemberId: true }, distinct: ["workspaceMemberId"] });
      ownerIds = members.map((x) => x.workspaceMemberId);
    }
    const now = options.now();
    const tasks = await options.database.task.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null, ...(ownerIds ? { OR: [{ assigneeMemberId: { in: ownerIds } }, { assigneeMemberId: null }] } : {}), AND: [{ OR: [{ accountPlanEpisode: { is: { status: "ACTIVE" } } }, { accountPlanTrack: { is: { status: "ACTIVE" } } }, { accountPlanWait: { is: { status: "PLANNED" } } }] }] }, include: { opportunity: { select: { id: true, name: true, lead: { select: { sourceId: true } } } }, assignee: { select: { user: { select: { displayName: true } } } }, accountPlanEpisode: { select: { type: true } }, accountPlanTrack: { select: { type: true } }, accountPlanWait: { select: { id: true } } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
    let visible = tasks;
    if (scope !== "WORKSPACE") {
      const [teams, rules] = await Promise.all([options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } }), options.database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId }, select: { sourceId: true, teamId: true, canRead: true } })]);
      const teamIds = new Set(teams.map((x) => x.teamId)); const governed = new Set(rules.map((x) => x.sourceId));
      visible = tasks.filter((task) => !task.opportunity || !governed.has(task.opportunity.lead.sourceId) || rules.some((rule) => rule.sourceId === task.opportunity?.lead.sourceId && teamIds.has(rule.teamId) && rule.canRead));
    }
    return { generatedAt: now.toISOString(), items: visible.map((task) => ({ id: task.id, kind: task.accountPlanEpisode ? "EPISODE" : task.accountPlanTrack ? "TRACK" : "WAIT", opportunityId: task.opportunity!.id, opportunityName: task.opportunity!.name, title: task.title, ownerMemberId: task.assigneeMemberId, ownerName: task.assignee?.user.displayName ?? null, dueAt: task.dueAt.toISOString(), status: task.status, overdue: task.dueAt < now, unassigned: !task.assigneeMemberId, href: `/oportunidades?opportunityId=${task.opportunity!.id}` })) };
  }
  return { getScreen, command, getCommitments };
}

let singleton: ReturnType<typeof createAccountPlanService> | null = null;
export function getAccountPlanService() { singleton ??= createAccountPlanService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
