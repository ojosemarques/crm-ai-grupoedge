import { z } from "zod";

import type {
  LifecycleSource,
  OwnershipEntityType,
  OwnershipFunction,
  OwnershipSource,
  Prisma,
  PrismaClient,
  RevenueLifecycleEntityType,
  RevenueLifecycleStage,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { JourneySnapshot, LifecycleTarget, OwnershipTarget } from "@/modules/lifecycle/domain/lifecycle-contracts";
import {
  isLifecycleTransitionAllowed,
  LIFECYCLE_RULE_KEY,
  LIFECYCLE_RULE_VERSION,
  requiredOwnershipFunction,
} from "@/modules/lifecycle/domain/lifecycle-policy";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<void>;
}>;

type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;
type Transaction = Prisma.TransactionClient;

const lifecycleEntityType = z.enum(["CONTACT", "ACCOUNT"]);
const ownershipEntityType = z.enum(["CONTACT", "ACCOUNT", "LEAD", "OPPORTUNITY"]);
const lifecycleStage = z.enum(["UNKNOWN", "PROSPECT", "LEAD", "QUALIFIED", "OPPORTUNITY", "CUSTOMER", "ONBOARDING", "ACTIVE", "RENEWAL", "CHURN", "INACTIVE"]);
const lifecycleSource = z.enum(["HUMAN", "LEAD_EVENT", "OPPORTUNITY_EVENT", "HANDOFF_EVENT", "BACKFILL", "SYSTEM_RULE", "SEED"]);
const ownershipFunction = z.enum(["MARKETING", "SDR", "CLOSER", "CUSTOMER_SUCCESS", "FARMER", "FINANCE", "REVOPS"]);
const ownershipSource = z.enum(["HUMAN", "LEAD_ASSIGNMENT", "OPPORTUNITY_ASSIGNMENT", "HANDOFF", "BACKFILL", "SYSTEM_RULE"]);

const lifecycleTargetSchema = z.object({ entityType: lifecycleEntityType, entityId: z.string().uuid() }).strict();
const ownershipTargetSchema = z.object({ entityType: ownershipEntityType, entityId: z.string().uuid() }).strict();

const transitionInput = lifecycleTargetSchema.extend({
  toStage: lifecycleStage,
  reason: z.string().trim().min(3).max(2000),
  source: lifecycleSource.default("HUMAN"),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedRevision: z.number().int().positive().nullable().optional(),
  override: z.boolean().default(false),
  confirmed: z.boolean().default(false),
}).strict();

const assignmentInput = ownershipTargetSchema.extend({
  function: ownershipFunction,
  memberId: z.string().uuid().nullable().optional(),
  queueId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(2000),
  source: ownershipSource.default("HUMAN"),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.memberId) !== Boolean(value.queueId), {
  message: "Informe exatamente um responsável: pessoa ou fila.",
});

const transferInput = ownershipTargetSchema.extend({
  fromFunction: ownershipFunction,
  toFunction: ownershipFunction,
  targetMemberId: z.string().uuid().nullable().optional(),
  targetQueueId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(2000),
  nextActionDescription: z.string().trim().max(500).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.targetMemberId) !== Boolean(value.targetQueueId), {
  message: "Informe exatamente um destino para a transferência.",
});

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function targetColumns(target: OwnershipTarget | LifecycleTarget) {
  return {
    contactId: target.entityType === "CONTACT" ? target.entityId : null,
    accountId: target.entityType === "ACCOUNT" ? target.entityId : null,
    leadId: target.entityType === "LEAD" ? target.entityId : null,
    opportunityId: target.entityType === "OPPORTUNITY" ? target.entityId : null,
  };
}

function lifecycleTargetColumns(target: LifecycleTarget) {
  return {
    contactId: target.entityType === "CONTACT" ? target.entityId : null,
    accountId: target.entityType === "ACCOUNT" ? target.entityId : null,
  };
}

function targetWhere(target: OwnershipTarget | LifecycleTarget) {
  if (target.entityType === "CONTACT") return { contactId: target.entityId };
  if (target.entityType === "ACCOUNT") return { accountId: target.entityId };
  if (target.entityType === "LEAD") return { leadId: target.entityId };
  return { opportunityId: target.entityId };
}

function resourceType(target: OwnershipTarget | LifecycleTarget): string {
  return target.entityType[0] + target.entityType.slice(1).toLowerCase();
}

async function lockTarget(tx: Transaction, workspaceId: string, target: OwnershipTarget | LifecycleTarget, discriminator: string) {
  const key = `${workspaceId}:${target.entityType}:${target.entityId}:${discriminator}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function assertTargetExists(tx: Transaction, workspaceId: string, target: OwnershipTarget | LifecycleTarget) {
  const where = { id: target.entityId, workspaceId };
  const exists = target.entityType === "CONTACT"
    ? await tx.contact.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
    : target.entityType === "ACCOUNT"
      ? await tx.account.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
      : target.entityType === "LEAD"
        ? await tx.lead.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
        : await tx.opportunity.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } });
  if (!exists) fail("Registro não encontrado neste workspace.", "NOT_FOUND", 404);
}

async function scopedResource(database: PrismaClient, context: AuthenticatedContext, target: OwnershipTarget | LifecycleTarget): Promise<ResourceScope> {
  const active = await database.ownershipAssignment.findFirst({
    where: { workspaceId: context.workspaceId, ...targetWhere(target), status: "ACTIVE" },
    select: { memberId: true, queueId: true, queue: { select: { teamId: true } } },
  });
  return {
    workspaceId: context.workspaceId,
    resourceType: resourceType(target),
    resourceId: target.entityId,
    ownerMemberId: active?.memberId ?? null,
    queueId: active?.queueId ?? null,
    teamId: active?.queue?.teamId ?? null,
  };
}

async function validateDestination(tx: Transaction, workspaceId: string, memberId: string | null, queueId: string | null) {
  if (memberId) {
    const member = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
    if (!member) fail("Responsável indisponível ou fora do workspace.", "INVALID_OWNER", 409);
  }
  if (queueId) {
    const queue = await tx.queue.findFirst({ where: { id: queueId, workspaceId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!queue) fail("Fila indisponível ou fora do workspace.", "INVALID_QUEUE", 409);
  }
}

async function assignInTransaction(
  tx: Transaction,
  context: AuthenticatedContext,
  input: z.infer<typeof assignmentInput>,
  now: Date,
) {
  const target: OwnershipTarget = { entityType: input.entityType, entityId: input.entityId };
  await lockTarget(tx, context.workspaceId, target, `ownership:${input.function}`);
  const duplicate = await tx.ownershipAssignment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
  if (duplicate) return duplicate;
  await assertTargetExists(tx, context.workspaceId, target);
  await validateDestination(tx, context.workspaceId, input.memberId ?? null, input.queueId ?? null);
  const current = await tx.ownershipAssignment.findFirst({ where: { workspaceId: context.workspaceId, ...targetWhere(target), function: input.function, status: "ACTIVE" } });
  if (current?.memberId === (input.memberId ?? null) && current?.queueId === (input.queueId ?? null)) return current;
  if (current) {
    await tx.ownershipAssignment.update({ where: { id: current.id }, data: { status: "ENDED", validTo: now, endedByActorId: context.actorId } });
  }
  const created = await tx.ownershipAssignment.create({ data: {
    workspaceId: context.workspaceId,
    entityType: input.entityType,
    ...targetColumns(target),
    function: input.function,
    memberId: input.memberId ?? null,
    queueId: input.queueId ?? null,
    status: "ACTIVE",
    validFrom: now,
    reason: input.reason,
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    assignedByActorId: context.actorId,
  } });
  await tx.auditLog.create({ data: {
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    action: current ? "ownership.reassigned" : "ownership.assigned",
    entityType: "OwnershipAssignment",
    entityId: created.id,
    reason: input.reason,
    changes: { target, function: input.function, previousAssignmentId: current?.id ?? null, memberId: input.memberId ?? null, queueId: input.queueId ?? null },
  } });
  return created;
}

export function createLifecycleService(options: Options) {
  async function getJourney(context: AuthenticatedContext, rawTarget: unknown): Promise<JourneySnapshot> {
    const target = lifecycleTargetSchema.parse(rawTarget) as LifecycleTarget;
    const scoped = await scopedResource(options.database, context, target);
    await Promise.all([
      options.authorization.assertAuthorized(context, PermissionKeys.LIFECYCLE_READ, scoped),
      options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_READ, scoped),
    ]);
    const [lifecycle, ownership, pendingTransfers] = await Promise.all([
      options.database.revenueLifecycle.findFirst({ where: { workspaceId: context.workspaceId, ...targetWhere(target) } }),
      options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, ...targetWhere(target), status: "ACTIVE" }, orderBy: [{ function: "asc" }, { validFrom: "desc" }], include: { member: { include: { user: { select: { displayName: true } } } }, queue: { select: { name: true } } } }),
      options.database.ownershipTransfer.findMany({ where: { workspaceId: context.workspaceId, ...targetWhere(target), status: "REQUESTED" }, orderBy: [{ dueAt: "asc" }, { requestedAt: "asc" }], include: { targetMember: { include: { user: { select: { displayName: true } } } }, targetQueue: { select: { name: true } } } }),
    ]);
    const required = requiredOwnershipFunction(lifecycle?.stage ?? "UNKNOWN");
    return {
      target,
      lifecycle: lifecycle ? { stage: lifecycle.stage, currentSince: lifecycle.currentSince.toISOString(), source: lifecycle.source, evidenceQuality: lifecycle.evidenceQuality, ruleKey: lifecycle.ruleKey, ruleVersion: lifecycle.ruleVersion, revision: lifecycle.revision } : null,
      ownership: ownership.map((item) => ({ id: item.id, function: item.function, destinationType: item.memberId ? "MEMBER" : "QUEUE", destinationId: item.memberId ?? item.queueId!, destinationName: item.member?.user.displayName ?? item.queue?.name ?? "Destino indisponível", validFrom: item.validFrom.toISOString() })),
      pendingTransfers: pendingTransfers.map((item) => ({ id: item.id, fromFunction: item.fromFunction, toFunction: item.toFunction, destinationName: item.targetMember?.user.displayName ?? item.targetQueue?.name ?? "Destino indisponível", reason: item.reason, dueAt: item.dueAt?.toISOString() ?? null })),
      missingRequiredOwner: required && !ownership.some((item) => item.function === required) ? required : null,
    };
  }

  async function transition(context: AuthenticatedContext, raw: unknown) {
    const input = transitionInput.parse(raw);
    const target: LifecycleTarget = { entityType: input.entityType, entityId: input.entityId };
    await options.authorization.assertAuthorized(context, input.override ? PermissionKeys.LIFECYCLE_OVERRIDE : PermissionKeys.LIFECYCLE_TRANSITION, await scopedResource(options.database, context, target));
    if (input.override && !input.confirmed) fail("Confirme explicitamente a correção de ciclo de vida.", "CONFIRMATION_REQUIRED", 409);
    return options.database.$transaction(async (tx) => {
      await lockTarget(tx, context.workspaceId, target, "lifecycle");
      const duplicate = await tx.lifecycleHistory.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (duplicate) return duplicate;
      await assertTargetExists(tx, context.workspaceId, target);
      const current = await tx.revenueLifecycle.findFirst({ where: { workspaceId: context.workspaceId, ...targetWhere(target) } });
      const fromStage = current?.stage ?? "UNKNOWN";
      if (input.expectedRevision && current?.revision !== input.expectedRevision) fail("O ciclo de vida foi alterado. Recarregue antes de confirmar.", "REVISION_CONFLICT", 409);
      if (!isLifecycleTransitionAllowed(fromStage, input.toStage, { source: input.source, override: input.override })) fail(`Transição de ${fromStage} para ${input.toStage} não permitida.`, "INVALID_LIFECYCLE_TRANSITION", 409);
      const required = requiredOwnershipFunction(input.toStage);
      if (required && !(await tx.ownershipAssignment.findFirst({ where: { workspaceId: context.workspaceId, ...targetWhere(target), function: required, status: "ACTIVE" }, select: { id: true } }))) {
        fail(`A etapa ${input.toStage} exige responsável operacional ${required}.`, "MISSING_REQUIRED_OWNER", 409);
      }
      const now = options.now();
      if (current?.lastHistoryId) await tx.lifecycleHistory.update({ where: { id: current.lastHistoryId }, data: { exitedAt: now } });
      const history = await tx.lifecycleHistory.create({ data: {
        workspaceId: context.workspaceId,
        entityType: input.entityType,
        ...lifecycleTargetColumns(target),
        fromStage,
        toStage: input.toStage,
        enteredAt: now,
        reason: input.reason,
        source: input.source,
        ruleKey: LIFECYCLE_RULE_KEY,
        ruleVersion: LIFECYCLE_RULE_VERSION,
        ...(input.evidence ? { evidence: input.evidence as Prisma.InputJsonValue } : {}),
        idempotencyKey: input.idempotencyKey,
        createdByActorId: context.actorId,
      } });
      if (current) {
        await tx.revenueLifecycle.update({ where: { id: current.id }, data: { stage: input.toStage, currentSince: now, source: input.source, evidenceQuality: input.evidence ? "CONFIRMED" : "INFERRED", lastHistoryId: history.id, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      } else {
        await tx.revenueLifecycle.create({ data: { workspaceId: context.workspaceId, entityType: input.entityType, ...lifecycleTargetColumns(target), stage: input.toStage, currentSince: now, source: input.source, ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION, evidenceQuality: input.evidence ? "CONFIRMED" : "INFERRED", lastHistoryId: history.id, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.override ? "lifecycle.overridden" : "lifecycle.transitioned", entityType: resourceType(target), entityId: target.entityId, reason: input.reason, changes: { fromStage, toStage: input.toStage, historyId: history.id, ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION } } });
      return history;
    }, { isolationLevel: "Serializable" });
  }

  async function assignOwnership(context: AuthenticatedContext, raw: unknown) {
    const input = assignmentInput.parse(raw);
    const target: OwnershipTarget = { entityType: input.entityType, entityId: input.entityId };
    await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_ASSIGN, await scopedResource(options.database, context, target));
    return options.database.$transaction((tx) => assignInTransaction(tx, context, input, options.now()), { isolationLevel: "Serializable" });
  }

  async function requestTransfer(context: AuthenticatedContext, raw: unknown) {
    const input = transferInput.parse(raw);
    const target: OwnershipTarget = { entityType: input.entityType, entityId: input.entityId };
    await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_TRANSFER, await scopedResource(options.database, context, target));
    return options.database.$transaction(async (tx) => {
      await lockTarget(tx, context.workspaceId, target, `transfer:${input.toFunction}`);
      const duplicate = await tx.ownershipTransfer.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (duplicate) return duplicate;
      await assertTargetExists(tx, context.workspaceId, target);
      await validateDestination(tx, context.workspaceId, input.targetMemberId ?? null, input.targetQueueId ?? null);
      const fromAssignment = await tx.ownershipAssignment.findFirst({ where: { workspaceId: context.workspaceId, ...targetWhere(target), function: input.fromFunction, status: "ACTIVE" } });
      if (!fromAssignment) fail("Não existe responsabilidade ativa para transferir.", "MISSING_CURRENT_OWNER", 409);
      const transfer = await tx.ownershipTransfer.create({ data: { workspaceId: context.workspaceId, entityType: input.entityType, ...targetColumns(target), fromFunction: input.fromFunction, toFunction: input.toFunction, fromAssignmentId: fromAssignment.id, targetMemberId: input.targetMemberId ?? null, targetQueueId: input.targetQueueId ?? null, reason: input.reason, nextActionDescription: input.nextActionDescription ?? null, dueAt: input.dueAt ?? null, requestedByActorId: context.actorId, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ownership.transfer.requested", entityType: "OwnershipTransfer", entityId: transfer.id, reason: input.reason, changes: { target, fromFunction: input.fromFunction, toFunction: input.toFunction, targetMemberId: input.targetMemberId ?? null, targetQueueId: input.targetQueueId ?? null } } });
      return transfer;
    }, { isolationLevel: "Serializable" });
  }

  async function respondTransfer(context: AuthenticatedContext, transferId: string, raw: unknown) {
    const response = z.object({ action: z.enum(["ACCEPT", "REJECT", "CANCEL"]), reason: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }).strict().parse(raw);
    const transfer = await options.database.ownershipTransfer.findFirst({ where: { id: transferId, workspaceId: context.workspaceId }, include: { targetQueue: { select: { teamId: true } } } });
    if (!transfer) fail("Transferência não encontrada.", "NOT_FOUND", 404);
    const target: OwnershipTarget = { entityType: transfer.entityType, entityId: transfer.contactId ?? transfer.accountId ?? transfer.leadId ?? transfer.opportunityId! };
    const permission = response.action === "CANCEL" ? PermissionKeys.OWNERSHIP_TRANSFER : PermissionKeys.OWNERSHIP_ACCEPT;
    const scoped = await scopedResource(options.database, context, target);
    await options.authorization.assertAuthorized(context, permission, { ...scoped, memberId: transfer.targetMemberId, teamId: transfer.targetQueue?.teamId ?? scoped.teamId ?? null });
    if (response.action === "CANCEL" && transfer.requestedByActorId !== context.actorId) {
      await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_ADMIN, scoped);
    }
    return options.database.$transaction(async (tx) => {
      await lockTarget(tx, context.workspaceId, target, `transfer:${transfer.toFunction}`);
      const current = await tx.ownershipTransfer.findFirst({ where: { id: transferId, workspaceId: context.workspaceId } });
      if (!current) fail("Transferência não encontrada.", "NOT_FOUND", 404);
      if (current.status !== "REQUESTED") return current;
      const now = options.now();
      if (response.action === "REJECT") {
        const rejected = await tx.ownershipTransfer.update({ where: { id: current.id }, data: { status: "REJECTED", rejectedAt: now, respondedByActorId: context.actorId } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ownership.transfer.rejected", entityType: "OwnershipTransfer", entityId: current.id, reason: response.reason } });
        return rejected;
      }
      if (response.action === "CANCEL") {
        const cancelled = await tx.ownershipTransfer.update({ where: { id: current.id }, data: { status: "CANCELLED", cancelledAt: now, respondedByActorId: context.actorId } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ownership.transfer.cancelled", entityType: "OwnershipTransfer", entityId: current.id, reason: response.reason } });
        return cancelled;
      }
      await assignInTransaction(tx, context, assignmentInput.parse({ ...target, function: current.toFunction, memberId: current.targetMemberId, queueId: current.targetQueueId, reason: response.reason, source: "HANDOFF", idempotencyKey: `${response.idempotencyKey}:assignment` }), now);
      const completed = await tx.ownershipTransfer.update({ where: { id: current.id }, data: { status: "COMPLETED", acceptedAt: now, completedAt: now, respondedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ownership.transfer.completed", entityType: "OwnershipTransfer", entityId: current.id, reason: response.reason } });
      return completed;
    }, { isolationLevel: "Serializable" });
  }

  async function listPendingTransfers(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_READ, { workspaceId: context.workspaceId, resourceType: "OwnershipTransfer", memberId: context.memberId });
    return options.database.ownershipTransfer.findMany({
      where: { workspaceId: context.workspaceId, status: "REQUESTED", OR: [{ targetMemberId: context.memberId }, { requestedByActorId: context.actorId }] },
      orderBy: [{ dueAt: "asc" }, { requestedAt: "asc" }],
      include: { targetMember: { include: { user: { select: { displayName: true } } } }, targetQueue: { select: { name: true } } },
    });
  }

  async function getOperationalSummary(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_ADMIN, { workspaceId: context.workspaceId, resourceType: "LifecycleGovernance" });
    const now = options.now();
    const [lifecycles, contactCount, accountCount, activeAssignments, pendingTransfers, overdueTransfers, latestBackfill] = await Promise.all([
      options.database.revenueLifecycle.findMany({ where: { workspaceId: context.workspaceId }, select: { stage: true, contactId: true, accountId: true } }),
      options.database.contact.count({ where: { workspaceId: context.workspaceId, deletedAt: null } }),
      options.database.account.count({ where: { workspaceId: context.workspaceId, deletedAt: null } }),
      options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE" }, select: { contactId: true, accountId: true, function: true } }),
      options.database.ownershipTransfer.count({ where: { workspaceId: context.workspaceId, status: "REQUESTED" } }),
      options.database.ownershipTransfer.count({ where: { workspaceId: context.workspaceId, status: "REQUESTED", dueAt: { lt: now } } }),
      options.database.lifecycleBackfillRun.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" } }),
    ]);
    const ownerKeys = new Set(activeAssignments.map((item) => `${item.contactId ?? `account:${item.accountId}`}:${item.function}`));
    const missingRequiredOwner = lifecycles.filter((item) => {
      const required = requiredOwnershipFunction(item.stage);
      const entity = item.contactId ?? `account:${item.accountId}`;
      return required ? !ownerKeys.has(`${entity}:${required}`) : false;
    }).length;
    const byStage = Object.fromEntries(lifecycles.map((item) => item.stage).sort().map((stage) => [stage, lifecycles.filter((item) => item.stage === stage).length]));
    return { generatedAt: now.toISOString(), byStage, coverage: { eligible: contactCount + accountCount, projected: lifecycles.length, percent: contactCount + accountCount ? Math.round((lifecycles.length / (contactCount + accountCount)) * 10_000) / 100 : null }, missingRequiredOwner, pendingTransfers, overdueTransfers, latestBackfill: latestBackfill ? { id: latestBackfill.id, mode: latestBackfill.mode, status: latestBackfill.status, processedCount: latestBackfill.processedCount, createdCount: latestBackfill.createdCount, existingCount: latestBackfill.existingCount, finishedAt: latestBackfill.finishedAt?.toISOString() ?? null } : null };
  }

  return Object.freeze({ getJourney, transition, assignOwnership, requestTransfer, respondTransfer, listPendingTransfers, getOperationalSummary });
}

let service: ReturnType<typeof createLifecycleService> | undefined;
export function getLifecycleService() {
  service ??= createLifecycleService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}

export type LifecycleService = ReturnType<typeof createLifecycleService>;
export type LifecycleTransitionInput = z.infer<typeof transitionInput>;
export type OwnershipAssignmentInput = z.infer<typeof assignmentInput>;
export type OwnershipTransferInput = z.infer<typeof transferInput>;
export type LifecycleDatabaseTypes = {
  lifecycleEntityType: RevenueLifecycleEntityType;
  lifecycleStage: RevenueLifecycleStage;
  lifecycleSource: LifecycleSource;
  ownershipEntityType: OwnershipEntityType;
  ownershipFunction: OwnershipFunction;
  ownershipSource: OwnershipSource;
};
