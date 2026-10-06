import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { z } from "zod";

type Options = Readonly<{
  database: PrismaClient;
  authorization: Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;
  now: () => Date;
}>;

const filtersSchema = z.object({
  kind: z.string().max(80).default(""),
  status: z.string().max(80).default(""),
  origin: z.string().max(80).default(""),
  owner: z.string().max(200).default(""),
  timeframe: z.enum(["ALL", "OVERDUE", "TODAY", "FUTURE"]).default("ALL"),
  grouping: z.enum(["NONE", "OWNER", "TYPE"]).default("NONE"),
  calendar: z.boolean().default(false),
}).strict();

const savedViewSchema = z.object({ name: z.string().trim().min(2).max(80), filters: filtersSchema }).strict();
const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("COMPLETE"), taskIds: z.array(z.string().uuid()).min(1).max(100), result: z.string().trim().min(2).max(2_000) }).strict(),
  z.object({ action: z.literal("REASSIGN"), taskIds: z.array(z.string().uuid()).min(1).max(100), assigneeMemberId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("POSTPONE"), taskIds: z.array(z.string().uuid()).min(1).max(100), dueAt: z.coerce.date() }).strict(),
]);

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

export function createUnifiedActivityService(options: Options) {
  const resource = (context: AuthenticatedContext) => ({ workspaceId: context.workspaceId, resourceType: "UnifiedActivityQueue", memberId: context.memberId, ownerMemberId: context.memberId });

  async function metadata(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.TASKS_READ, resource(context));
    const [write, assign, members, views] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.TASKS_WRITE, resource(context)),
      options.authorization.authorize(context, PermissionKeys.LEADS_ASSIGN, resource(context)),
      options.database.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null, status: "ACTIVE" },
        orderBy: { user: { displayName: "asc" } },
        select: { id: true, user: { select: { displayName: true } } },
      }),
      options.database.savedView.findMany({
        where: { workspaceId: context.workspaceId, ownerMemberId: context.memberId, entityType: "TASK", deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, filters: true },
      }),
    ]);
    return {
      canWrite: write.allowed,
      canAssign: assign.allowed,
      assignmentTargets: assign.allowed ? members.map((member) => ({ id: member.id, name: member.user.displayName })) : [],
      savedViews: views.flatMap((view) => {
        const filters = filtersSchema.safeParse(view.filters);
        return filters.success ? [{ id: view.id, name: view.name, filters: filters.data }] : [];
      }),
    };
  }

  async function createSavedView(context: AuthenticatedContext, payload: unknown) {
    const parsed = savedViewSchema.safeParse(payload);
    if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join(" "));
    await options.authorization.assertAuthorized(context, PermissionKeys.TASKS_READ, resource(context));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-task-view:${context.workspaceId}:${context.memberId}`}, 0))`;
      const duplicate = await tx.savedView.findFirst({ where: { workspaceId: context.workspaceId, ownerMemberId: context.memberId, entityType: "TASK", name: { equals: parsed.data.name, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
      if (duplicate) fail("Já existe um filtro salvo com esse nome.", "SAVED_VIEW_ALREADY_EXISTS", 409);
      const view = await tx.savedView.create({ data: { workspaceId: context.workspaceId, ownerMemberId: context.memberId, entityType: "TASK", name: parsed.data.name, isShared: false, filters: json(parsed.data.filters), createdByActorId: context.actorId, updatedByActorId: context.actorId }, select: { id: true, name: true } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "saved_view.created", entityType: "SavedView", entityId: view.id, changes: json({ entityType: "TASK", name: view.name }) } });
      return { ...view, filters: parsed.data.filters };
    });
  }

  async function deleteSavedView(context: AuthenticatedContext, viewId: string) {
    if (!z.string().uuid().safeParse(viewId).success) fail("Filtro salvo inválido.");
    await options.authorization.assertAuthorized(context, PermissionKeys.TASKS_READ, resource(context));
    const view = await options.database.savedView.findFirst({ where: { id: viewId, workspaceId: context.workspaceId, ownerMemberId: context.memberId, entityType: "TASK", deletedAt: null }, select: { id: true, name: true } });
    if (!view) fail("Filtro salvo não encontrado.", "NOT_FOUND", 404);
    await options.database.$transaction(async (tx) => {
      await tx.savedView.update({ where: { id: view.id }, data: { deletedAt: options.now(), updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "saved_view.deleted", entityType: "SavedView", entityId: view.id, changes: json({ entityType: "TASK", name: view.name }) } });
    });
    return { id: view.id };
  }

  async function bulkCommand(context: AuthenticatedContext, payload: unknown) {
    const parsed = bulkSchema.safeParse(payload);
    if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join(" "));
    const taskIds = [...new Set(parsed.data.taskIds)].sort();
    const tasks = await options.database.task.findMany({
      where: { workspaceId: context.workspaceId, id: { in: taskIds }, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
      select: { id: true, leadId: true, opportunityId: true, kind: true, status: true, title: true, dueAt: true, assigneeMemberId: true, lead: { select: { ownerMemberId: true, queueId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
    });
    if (tasks.length !== taskIds.length) fail("Uma ou mais tarefas não estão abertas ou não existem.", "TASK_NOT_AVAILABLE", 409);
    await Promise.all(tasks.map((task) => options.authorization.assertAuthorized(context, PermissionKeys.TASKS_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "Task",
      resourceId: task.id,
      ownerMemberId: task.lead.ownerMemberId,
      queueId: task.lead.queueId,
      teamId: task.lead.routingQueue?.teamId ?? task.lead.queue?.teamId ?? null,
    })));
    if (parsed.data.action === "REASSIGN") {
      await Promise.all(tasks.map((task) => options.authorization.assertAuthorized(context, PermissionKeys.LEADS_ASSIGN, {
        workspaceId: context.workspaceId,
        resourceType: "Task",
        resourceId: task.id,
        ownerMemberId: task.lead.ownerMemberId,
        queueId: task.lead.queueId,
        teamId: task.lead.routingQueue?.teamId ?? task.lead.queue?.teamId ?? null,
      })));
    }
    if (parsed.data.action === "COMPLETE" && tasks.some((task) => task.kind === "IMMEDIATE_CALL")) fail("A tarefa Ligar agora deve ser concluída pelo registro da ligação.", "CONTACT_ACTIVITY_REQUIRED", 409);
    if (parsed.data.action === "POSTPONE" && parsed.data.dueAt <= options.now()) fail("O novo prazo precisa estar no futuro.");
    if (parsed.data.action === "REASSIGN") {
      const member = await options.database.workspaceMember.findFirst({ where: { id: parsed.data.assigneeMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
      if (!member) fail("O novo responsável não está ativo neste workspace.", "ASSIGNEE_NOT_FOUND", 404);
    }

    const at = options.now();
    await options.database.$transaction(async (tx) => {
      for (const id of taskIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`task:${context.workspaceId}:${id}`}, 0))`;
      if (parsed.data.action === "COMPLETE") {
        await tx.task.updateMany({ where: { workspaceId: context.workspaceId, id: { in: taskIds }, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, data: { status: "COMPLETED", completedAt: at, result: parsed.data.result, updatedByActorId: context.actorId } });
        await tx.opportunityStageActivityInstance.updateMany({ where: { workspaceId: context.workspaceId, taskId: { in: taskIds }, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: at } });
        for (const task of tasks) {
          const next = await tx.task.findFirst({ where: { workspaceId: context.workspaceId, leadId: task.leadId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, dueAt: true, title: true } });
          await tx.lead.update({ where: { id: task.leadId }, data: { nextActionTaskId: next?.id ?? null, nextActionAt: next?.dueAt ?? null, nextActionDescription: next?.title ?? null, lastActivityAt: at, updatedByActorId: context.actorId } });
          if (task.opportunityId) {
            const opportunityNext = await tx.task.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: task.opportunityId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, dueAt: true, title: true } });
            await tx.opportunity.update({ where: { id: task.opportunityId }, data: { nextActionTaskId: opportunityNext?.id ?? null, nextActionAt: opportunityNext?.dueAt ?? null, nextActionDescription: opportunityNext?.title ?? null, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
          }
          const activity = await tx.activity.create({ data: { workspaceId: context.workspaceId, leadId: task.leadId, ...(task.opportunityId ? { opportunityId: task.opportunityId } : {}), type: "TASK", direction: "INTERNAL", result: "COMPLETED", subject: `Tarefa concluída: ${task.title}`, description: parsed.data.result, occurredAt: at, previousValues: json({ taskId: task.id, status: task.status }), newValues: json({ taskId: task.id, status: "COMPLETED", completedAt: at.toISOString() }), createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: at, updatedAt: at } });
          await recordCommercialMetricFactInTransaction(tx, {
            workspaceId: context.workspaceId,
            eventKey: `task:${task.id}:completed:v1`,
            eventType: "TASK_COMPLETED",
            occurredAt: at,
            sourceEntityType: "Task",
            sourceEntityId: task.id,
            leadId: task.leadId,
            opportunityId: task.opportunityId,
            taskId: task.id,
            activityId: activity.id,
            creditedMemberId: task.assigneeMemberId,
            performedByMemberId: context.memberId,
            leadOwnerMemberIdAtEvent: task.lead.ownerMemberId,
            taskKind: task.kind,
            activityType: "TASK",
            result: parsed.data.result,
            executionMode: "MANUAL",
            safeMetadata: { dueAt: task.dueAt.toISOString(), completedOnTime: at <= task.dueAt },
          });
          if (task.kind === "INSTAGRAM_FOLLOW") {
            await recordCommercialMetricFactInTransaction(tx, {
              workspaceId: context.workspaceId,
              eventKey: `task:${task.id}:instagram-follow-completed:v1`,
              eventType: "INSTAGRAM_FOLLOW_COMPLETED",
              occurredAt: at,
              sourceEntityType: "Task",
              sourceEntityId: task.id,
              leadId: task.leadId,
              opportunityId: task.opportunityId,
              taskId: task.id,
              activityId: activity.id,
              creditedMemberId: task.assigneeMemberId,
              performedByMemberId: context.memberId,
              leadOwnerMemberIdAtEvent: task.lead.ownerMemberId,
              taskKind: task.kind,
              channel: "INSTAGRAM",
              result: parsed.data.result,
              executionMode: "MANUAL",
            });
          }
          await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "task.bulk_completed", entityType: "Task", entityId: task.id, occurredAt: at, changes: json({ fromStatus: task.status, result: parsed.data.result }) } });
        }
      } else if (parsed.data.action === "REASSIGN") {
        const assigneeMemberId = parsed.data.assigneeMemberId;
        await tx.task.updateMany({ where: { workspaceId: context.workspaceId, id: { in: taskIds }, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, data: { assigneeMemberId, queueId: null, updatedByActorId: context.actorId } });
        await Promise.all(tasks.map((task) => tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "task.bulk_reassigned", entityType: "Task", entityId: task.id, occurredAt: at, changes: json({ fromAssigneeMemberId: task.assigneeMemberId, toAssigneeMemberId: assigneeMemberId }) } })));
      } else {
        const dueAt = parsed.data.dueAt;
        await tx.task.updateMany({ where: { workspaceId: context.workspaceId, id: { in: taskIds }, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, data: { dueAt, updatedByActorId: context.actorId } });
        await tx.opportunityStageActivityInstance.updateMany({ where: { workspaceId: context.workspaceId, taskId: { in: taskIds }, status: "ACTIVE" }, data: { dueAt } });
        await Promise.all(tasks.map(async (task) => {
          await tx.lead.updateMany({ where: { id: task.leadId, workspaceId: context.workspaceId, nextActionTaskId: task.id }, data: { nextActionAt: dueAt, updatedByActorId: context.actorId } });
          if (task.opportunityId) await tx.opportunity.updateMany({ where: { id: task.opportunityId, workspaceId: context.workspaceId, nextActionTaskId: task.id }, data: { nextActionAt: dueAt, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
          await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "task.bulk_postponed", entityType: "Task", entityId: task.id, occurredAt: at, changes: json({ fromDueAt: task.dueAt.toISOString(), toDueAt: dueAt.toISOString() }) } });
        }));
      }
    });
    return { action: parsed.data.action, affected: taskIds.length, taskIds };
  }

  return Object.freeze({ metadata, createSavedView, deleteSavedView, bulkCommand });
}

let singleton: ReturnType<typeof createUnifiedActivityService> | undefined;
export function getUnifiedActivityService() {
  singleton ??= createUnifiedActivityService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
