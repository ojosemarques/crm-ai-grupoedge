import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { opportunityBulkExecuteSchema, opportunityBulkPreviewSchema } from "@/modules/pipeline-templates/domain/pipeline-template-contracts";
import { assertPipelineRequiredFields } from "@/modules/pipeline-templates/application/opportunity-required-fields";
import { getAuthorizationService, type AuthorizationDecision, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Readonly<{ authorize(context: AuthenticatedContext, permission: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision> }>;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

function fail(code: string, message: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}
function asJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function lock(transaction: Prisma.TransactionClient, workspaceId: string, id: string) { await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`opportunity:${workspaceId}:${id}`}, 0))`; }

type OpportunityForBulk = Awaited<ReturnType<typeof loadOpportunities>>[number];
async function loadOpportunities(database: PrismaClient | Prisma.TransactionClient, workspaceId: string, ids: string[]) {
  return database.opportunity.findMany({
    where: { workspaceId, id: { in: ids }, deletedAt: null },
    include: { lead: { select: { sourceId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } }, currentStage: true },
    orderBy: { id: "asc" },
  });
}

export function createOpportunityBulkService(options: Options) {
  async function assertAccess(context: AuthenticatedContext, opportunity: OpportunityForBulk, capability: "canReassign" | "canTransition", database: PrismaClient | Prisma.TransactionClient = options.database) {
    const teamId = opportunity.lead.routingQueue?.teamId ?? opportunity.lead.queue?.teamId ?? null;
    const decision = await options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, teamId });
    if (!decision.allowed) fail("ACCESS_DENIED", "Você não pode alterar uma ou mais oportunidades.", 403);
    if (decision.scope === "WORKSPACE") return;
    const rules = await database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId, sourceId: opportunity.lead.sourceId }, select: { teamId: true, canReassign: true, canTransition: true } });
    if (!rules.length) return;
    const memberships = await database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
    const ownTeams = new Set(memberships.map((membership) => membership.teamId));
    if (!rules.some((rule) => ownTeams.has(rule.teamId) && rule[capability])) fail("ORIGIN_TEAM_DENIED", "A origem não permite esta ação para a equipe do vendedor.", 403);
  }

  async function validateTarget(context: AuthenticatedContext, opportunities: OpportunityForBulk[], action: "REASSIGN" | "TRANSITION", targetId: string) {
    if (action === "REASSIGN") {
      const target = await options.database.workspaceMember.findFirst({ where: { id: targetId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, teamMemberships: { where: { deletedAt: null }, select: { teamId: true } } } });
      if (!target) fail("TARGET_NOT_FOUND", "Responsável de destino não encontrado.", 404);
      const teams = new Set(target.teamMemberships.map((item) => item.teamId));
      if (opportunities.some((opportunity) => { const teamId = opportunity.lead.routingQueue?.teamId ?? opportunity.lead.queue?.teamId; return teamId && !teams.has(teamId); })) fail("TARGET_OUTSIDE_TEAM", "O responsável de destino não pertence à equipe da origem.");
      return;
    }
    const stages = await options.database.pipelineStage.findMany({ where: { id: targetId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, pipelineId: true, type: true, opportunityStageCode: true } });
    const target = stages[0];
    if (!target || opportunities.some((opportunity) => opportunity.pipelineId !== target.pipelineId)) fail("TARGET_STAGE_INVALID", "Etapa de destino inválida para uma ou mais oportunidades.", 400);
    if (target.type !== "OPEN" || !target.opportunityStageCode || target.opportunityStageCode === "PROPOSAL") fail("BULK_TRANSITION_REQUIRES_INDIVIDUAL_FLOW", "Etapas de proposta, ganho e perda exigem o fluxo individual com seus gates.", 400);
    const allowed = await options.database.pipelineStageTransition.count({ where: { workspaceId: context.workspaceId, toStageId: targetId, fromStageId: { in: [...new Set(opportunities.map((item) => item.currentStageId))] }, active: true } });
    if (allowed !== new Set(opportunities.map((item) => item.currentStageId)).size) fail("TRANSITION_NOT_ALLOWED", "Há oportunidades sem transição permitida para a etapa de destino.", 400);
  }

  async function preview(context: AuthenticatedContext, payload: unknown) {
    const parsed = opportunityBulkPreviewSchema.safeParse(payload);
    if (!parsed.success) fail("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join(" "), 400);
    const input = parsed.data;
    const ids = [...new Set(input.opportunityIds)].sort();
    const expected = new Map(input.expectedRevisions.map((item) => [item.id, item.revision]));
    if (expected.size !== ids.length || ids.some((id) => !expected.has(id))) fail("INVALID_EXPECTED_REVISIONS", "Informe uma revisão para cada oportunidade.", 400);
    const opportunities = await loadOpportunities(options.database, context.workspaceId, ids);
    if (opportunities.length !== ids.length) fail("NOT_FOUND", "Uma ou mais oportunidades não existem neste workspace.", 404);
    for (const opportunity of opportunities) { await assertAccess(context, opportunity, input.action === "REASSIGN" ? "canReassign" : "canTransition"); if (opportunity.revision !== expected.get(opportunity.id)) fail("OPPORTUNITY_CHANGED", "Uma oportunidade mudou. Recarregue antes da prévia."); }
    await validateTarget(context, opportunities, input.action, input.targetId);
    const signature = hash({ workspaceId: context.workspaceId, ids, action: input.action, targetId: input.targetId, expected: [...expected], actorId: context.actorId });
    const createdAt = options.now();
    const operation = await options.database.opportunityBulkOperation.upsert({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint: signature } }, create: { workspaceId: context.workspaceId, action: input.action, targetId: input.targetId, reason: input.reason, fingerprint: signature, expectedCount: ids.length, expiresAt: new Date(createdAt.getTime() + 10 * 60_000), createdByActorId: context.actorId, createdAt, items: { create: opportunities.map((item) => ({ opportunityId: item.id, expectedRevision: item.revision, previousOwnerId: item.ownerMemberId, previousStageId: item.currentStageId })) } }, update: {}, include: { items: true } });
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "opportunity.bulk.previewed", entityType: "OpportunityBulkOperation", entityId: operation.id, reason: input.reason, changes: asJson({ action: input.action, targetId: input.targetId, opportunityIds: ids }) } });
    return operation;
  }

  async function execute(context: AuthenticatedContext, payload: unknown) {
    const parsed = opportunityBulkExecuteSchema.safeParse(payload);
    if (!parsed.success) fail("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join(" "), 400);
    return options.database.$transaction(async (transaction) => {
      const operation = await transaction.opportunityBulkOperation.findFirst({ where: { id: parsed.data.operationId, workspaceId: context.workspaceId }, include: { items: { orderBy: { opportunityId: "asc" } } } });
      if (!operation) fail("NOT_FOUND", "Operação não encontrada.", 404);
      if (operation.status !== "PREVIEWED" || operation.expiresAt <= options.now()) fail("PREVIEW_EXPIRED", "A prévia expirou ou já foi executada.");
      for (const item of operation.items) await lock(transaction, context.workspaceId, item.opportunityId);
      const opportunities = await loadOpportunities(transaction, context.workspaceId, operation.items.map((item) => item.opportunityId));
      if (opportunities.length !== operation.expectedCount) fail("OPPORTUNITY_CHANGED", "O conjunto de oportunidades mudou.");
      const expected = new Map(operation.items.map((item) => [item.opportunityId, item.expectedRevision]));
      for (const opportunity of opportunities) { await assertAccess(context, opportunity, operation.action === "REASSIGN" ? "canReassign" : "canTransition", transaction); if (opportunity.revision !== expected.get(opportunity.id)) fail("OPPORTUNITY_CHANGED", "Uma oportunidade mudou após a prévia."); }
      await validateTarget(context, opportunities, operation.action, operation.targetId);
      const changedAt = options.now();
      for (const opportunity of opportunities) {
        if (operation.action === "REASSIGN") {
          await transaction.opportunity.update({ where: { id: opportunity.id }, data: { ownerMemberId: operation.targetId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
          await transaction.task.updateMany({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, data: { assigneeMemberId: operation.targetId, queueId: null, updatedByActorId: context.actorId } });
        } else {
          await assertPipelineRequiredFields(transaction, opportunity.id, operation.targetId);
          const target = await transaction.pipelineStage.findUniqueOrThrow({ where: { id: operation.targetId } });
          if (target.opportunityStageCode === "MEETING_HELD" && !(await transaction.meeting.count({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: "COMPLETED", deletedAt: null } }))) fail("MEETING_ATTENDANCE_REQUIRED", "Registre o comparecimento antes da transição.");
          if (target.opportunityStageCode === "NEGOTIATION" && !(await transaction.offer.count({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, deletedAt: null } }))) fail("PROPOSAL_REQUIRED", "Negociação exige proposta registrada.");
          if (!(await transaction.task.count({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } }))) fail("NEXT_ACTION_REQUIRED", "Etapa aberta exige próxima ação.");
          const history = await transaction.stageHistory.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, exitedAt: null }, orderBy: { enteredAt: "desc" } });
          const effectiveAt = history && changedAt <= history.enteredAt ? new Date(history.enteredAt.getTime() + 1) : changedAt;
          if (history) await transaction.stageHistory.update({ where: { id: history.id }, data: { exitedAt: effectiveAt, exitedByActorId: context.actorId } });
          await transaction.opportunity.update({ where: { id: opportunity.id }, data: { currentStageId: target.id, status: target.type === "WON" ? "WON" : target.type === "LOST" ? "LOST" : "OPEN", closedAt: target.type === "OPEN" ? null : effectiveAt, revision: { increment: 1 }, updatedByActorId: context.actorId } });
          await transaction.stageHistory.create({ data: { workspaceId: context.workspaceId, pipelineId: opportunity.pipelineId, stageId: target.id, opportunityId: opportunity.id, enteredAt: effectiveAt, enteredByActorId: context.actorId, transitionOrigin: "OPPORTUNITY_LIST", transitionReason: operation.reason } });
        }
        await transaction.opportunityBulkOperationItem.update({ where: { workspaceId_operationId_opportunityId: { workspaceId: context.workspaceId, operationId: operation.id, opportunityId: opportunity.id } }, data: { resultingRevision: opportunity.revision + 1 } });
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: operation.action === "REASSIGN" ? "opportunity.bulk.reassigned" : "opportunity.bulk.transitioned", entityType: "Opportunity", entityId: opportunity.id, reason: operation.reason, changes: asJson({ targetId: operation.targetId, previousOwnerId: opportunity.ownerMemberId, previousStageId: opportunity.currentStageId, revision: opportunity.revision + 1 }) } });
      }
      await transaction.opportunityBulkOperation.update({ where: { id: operation.id }, data: { status: "EXECUTED", executedAt: changedAt } });
      return { operationId: operation.id, status: "EXECUTED" as const, affectedCount: opportunities.length, items: opportunities.map((item) => ({ opportunityId: item.id, resultingRevision: item.revision + 1 })) };
    });
  }
  return Object.freeze({ preview, execute });
}

let singleton: ReturnType<typeof createOpportunityBulkService> | undefined;
export function getOpportunityBulkService() { singleton ??= createOpportunityBulkService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
