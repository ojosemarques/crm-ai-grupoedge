import type {
  LeadAssignmentType,
  Prisma,
} from "@/generated/prisma/client";
import { projectLeadOwnership } from "@/modules/lifecycle/application/lifecycle-projection-writer";
import { ApplicationError } from "@/shared/core/errors/application-error";

export type LeadAssignmentOperationResult = Readonly<{
  assignmentId: string;
  leadId: string;
  ownerMemberId: string | null;
  queueId: string | null;
}>;

export type LeadAssignmentOperationInput = Readonly<{
  workspaceId: string;
  actorId: string;
  leadId: string;
  targetMemberId: string | null;
  expectedOwnerMemberId?: string;
  reason: string;
  type: LeadAssignmentType;
  requireGeneralQueueOrigin: boolean;
  reassignAllOpenTasks?: boolean;
  assignedAt: Date;
}>;

function notFound(message: string): never {
  throw new ApplicationError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

async function lockLead(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`lead-distribution:${workspaceId}:${leadId}`}, 0)
    )
  `;
}

async function assertEligibleSdr(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  memberId: string,
  teamId: string,
): Promise<void> {
  const eligible = await transaction.workspaceMember.findFirst({
    where: {
      id: memberId,
      workspaceId,
      status: "ACTIVE",
      deletedAt: null,
      leadReceivingPausedAt: null,
      user: { status: "ACTIVE", deletedAt: null },
      teamMemberships: {
        some: { teamId, function: "SDR", deletedAt: null },
      },
    },
    select: { id: true },
  });

  if (!eligible) {
    conflict(
      "SDR_UNAVAILABLE",
      "O SDR de destino está inativo, pausado ou fora da equipe de roteamento.",
    );
  }
}

/**
 * Primitiva transacional única de mudança de responsabilidade. A autorização
 * do ator é feita pelo caso de uso chamador; esta função revalida invariantes,
 * mantém tarefa, timeline, alerta e auditoria no mesmo commit.
 */
export async function reassignLeadInTransaction(
  transaction: Prisma.TransactionClient,
  input: LeadAssignmentOperationInput,
): Promise<LeadAssignmentOperationResult> {
  await lockLead(transaction, input.workspaceId, input.leadId);

  const lead = await transaction.lead.findFirst({
    where: {
      id: input.leadId,
      workspaceId: input.workspaceId,
      deletedAt: null,
    },
    select: {
      id: true,
      ownerMemberId: true,
      queueId: true,
      nextActionAt: true,
      nextActionDescription: true,
      routingQueueId: true,
      routingQueue: {
        select: { id: true, teamId: true, isGeneral: true, deletedAt: true },
      },
      queue: {
        select: { id: true, teamId: true, isGeneral: true, deletedAt: true },
      },
    },
  });
  if (!lead) notFound("Lead não encontrado.");

  if (
    input.expectedOwnerMemberId !== undefined &&
    lead.ownerMemberId !== input.expectedOwnerMemberId
  ) {
    conflict(
      "ASSIGNMENT_CHANGED",
      "A responsabilidade do lead mudou durante a operação. Recarregue e tente novamente.",
    );
  }

  const routingQueue = lead.routingQueue ?? lead.queue;
  if (
    !routingQueue ||
    routingQueue.deletedAt ||
    !routingQueue.isGeneral ||
    !routingQueue.teamId
  ) {
    conflict(
      "ROUTING_CONFIGURATION_UNAVAILABLE",
      "A Fila Geral e sua equipe de roteamento não estão disponíveis.",
    );
  }

  if (input.requireGeneralQueueOrigin && lead.queueId !== routingQueue.id) {
    conflict(
      "MANUAL_ASSIGNMENT_REQUIRES_QUEUE",
      "A distribuição manual só se aplica a lead atualmente na Fila Geral.",
    );
  }

  if (input.targetMemberId) {
    await assertEligibleSdr(
      transaction,
      input.workspaceId,
      input.targetMemberId,
      routingQueue.teamId,
    );
  }

  if (
    (input.targetMemberId && lead.ownerMemberId === input.targetMemberId) ||
    (!input.targetMemberId && lead.queueId === routingQueue.id)
  ) {
    conflict("NO_ASSIGNMENT_CHANGE", "O destino já é o responsável atual.");
  }

  await transaction.lead.update({
    where: { id: lead.id },
    data: {
      ownerMemberId: input.targetMemberId,
      queueId: input.targetMemberId ? null : routingQueue.id,
      routingQueueId: routingQueue.id,
      updatedByActorId: input.actorId,
    },
  });
  await transaction.task.updateMany({
    where: {
      workspaceId: input.workspaceId,
      leadId: lead.id,
      ...(input.reassignAllOpenTasks ? {} : { kind: "IMMEDIATE_CALL" as const }),
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    data: {
      assigneeMemberId: input.targetMemberId,
      queueId: input.targetMemberId ? null : routingQueue.id,
      updatedByActorId: input.actorId,
    },
  });

  const assignment = await transaction.leadAssignment.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: lead.id,
      fromMemberId: lead.ownerMemberId,
      fromQueueId: lead.queueId,
      toMemberId: input.targetMemberId,
      toQueueId: input.targetMemberId ? null : routingQueue.id,
      type: input.type,
      reason: input.reason,
      assignedAt: input.assignedAt,
      createdByActorId: input.actorId,
    },
    select: { id: true },
  });

  await projectLeadOwnership(transaction, {
    workspaceId: input.workspaceId,
    leadId: lead.id,
    memberId: input.targetMemberId,
    queueId: input.targetMemberId ? null : routingQueue.id,
    actorId: input.actorId,
    occurredAt: input.assignedAt,
    sourceEntityId: assignment.id,
  });

  if (input.targetMemberId) {
    await transaction.operationalAlert.updateMany({
      where: {
        workspaceId: input.workspaceId,
        leadId: lead.id,
        type: "GENERAL_QUEUE_ASSIGNMENT",
        status: "OPEN",
      },
      data: {
        status: "RESOLVED",
        resolvedAt: input.assignedAt,
        resolvedByActorId: input.actorId,
      },
    });
  } else {
    const alert = await transaction.operationalAlert.findFirst({
      where: {
        workspaceId: input.workspaceId,
        leadId: lead.id,
        type: "GENERAL_QUEUE_ASSIGNMENT",
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!alert) {
      await transaction.operationalAlert.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          queueId: routingQueue.id,
          type: "GENERAL_QUEUE_ASSIGNMENT",
          title: "Lead aguardando responsável",
          message: `Lead enviado à Fila Geral. Motivo: ${input.reason}`,
          createdByActorId: input.actorId,
        },
      });
    }
  }

  await transaction.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: lead.id,
      type: "RESPONSIBLE_CHANGE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject:
        input.type === "MANUAL"
          ? "Distribuição manual"
          : "Lead redistribuído",
      description: input.reason,
      occurredAt: input.assignedAt,
      nextActionAt: lead.nextActionAt,
      nextActionDescription: lead.nextActionDescription,
      previousValues: {
        memberId: lead.ownerMemberId,
        queueId: lead.queueId,
      },
      newValues: {
        memberId: input.targetMemberId,
        queueId: input.targetMemberId ? null : routingQueue.id,
      },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
  });
  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action:
        input.type === "MANUAL"
          ? "lead.assignment.manual"
          : "lead.assignment.redistributed",
      entityType: "Lead",
      entityId: lead.id,
      occurredAt: input.assignedAt,
      changes: {
        assignmentId: assignment.id,
        fromMemberId: lead.ownerMemberId,
        fromQueueId: lead.queueId,
        toMemberId: input.targetMemberId,
        toQueueId: input.targetMemberId ? null : routingQueue.id,
        reason: input.reason,
      },
    },
  });

  return Object.freeze({
    assignmentId: assignment.id,
    leadId: lead.id,
    ownerMemberId: input.targetMemberId,
    queueId: input.targetMemberId ? null : routingQueue.id,
  });
}
