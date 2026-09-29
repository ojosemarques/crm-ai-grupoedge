import type { LeadPriority, Prisma } from "@/generated/prisma/client";
import { projectLeadOwnership } from "@/modules/lifecycle/application/lifecycle-projection-writer";

export type OperationalOwner = Readonly<
  | { type: "MEMBER"; memberId: string; queueId: null }
  | { type: "QUEUE"; memberId: null; queueId: string }
>;

type RouteInput = Readonly<{
  workspaceId: string;
  queueId: string;
  teamId: string | null;
  actorId: string;
  routedAt: Date;
}>;

type InitialArtifactsInput = Readonly<{
  workspaceId: string;
  leadId: string;
  submissionId: string;
  priorityBandId: string;
  priority: LeadPriority;
  owner: OperationalOwner;
  previousOwner?: OperationalOwner | null;
  actorId: string;
  receivedAt: Date;
  doNotContact: boolean;
  requestId: string;
}>;

/**
 * O lock transacional impede que entradas simultâneas leiam o mesmo cursor.
 * A ordem inclui toda a escala de SDRs; membros pausados/inativos são pulados,
 * mas continuam servindo como posição estável quando eram o último cursor.
 */
export async function chooseRoundRobinOwner(
  transaction: Prisma.TransactionClient,
  input: RouteInput,
): Promise<OperationalOwner> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`lead-round-robin:${input.workspaceId}:${input.queueId}`}, 0)
    )
  `;

  const routingSettings = await transaction.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { distributionStrategy: true, maxOpenLeadsPerSdr: true },
  });

  const roster = input.teamId
    ? await transaction.teamMember.findMany({
        where: {
          workspaceId: input.workspaceId,
          teamId: input.teamId,
          function: "SDR",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          deletedAt: true,
          workspaceMemberId: true,
          member: {
            select: {
              status: true,
              deletedAt: true,
              leadReceivingPausedAt: true,
              user: { select: { status: true, deletedAt: true } },
            },
          },
        },
      })
    : [];

  const state = await transaction.roundRobinState.findUnique({
    where: {
      workspaceId_queueId: {
        workspaceId: input.workspaceId,
        queueId: input.queueId,
      },
    },
    select: { lastAssignedTeamMemberId: true },
  });
  const cursorIndex = roster.findIndex(
    ({ id }) => id === state?.lastAssignedTeamMemberId,
  );
  const ordered = roster.map(
    (_, offset) => roster[(cursorIndex + 1 + offset) % roster.length],
  );
  const openCounts = routingSettings.maxOpenLeadsPerSdr === null || roster.length === 0
    ? new Map<string, number>()
    : new Map((await transaction.lead.groupBy({
        by: ["ownerMemberId"],
        where: {
          workspaceId: input.workspaceId,
          ownerMemberId: { in: roster.map((candidate) => candidate.workspaceMemberId) },
          status: { in: ["OPEN", "QUALIFIED"] },
          deletedAt: null,
        },
        _count: { _all: true },
      })).flatMap((row) => row.ownerMemberId ? [[row.ownerMemberId, row._count._all] as const] : []));
  const selected = ordered.find(
    (candidate) =>
      candidate !== undefined &&
      candidate.deletedAt === null &&
      candidate.member.status === "ACTIVE" &&
      candidate.member.deletedAt === null &&
      candidate.member.leadReceivingPausedAt === null &&
      candidate.member.user.status === "ACTIVE" &&
      candidate.member.user.deletedAt === null &&
      (routingSettings.maxOpenLeadsPerSdr === null ||
        (openCounts.get(candidate.workspaceMemberId) ?? 0) < routingSettings.maxOpenLeadsPerSdr),
  );

  await transaction.roundRobinState.upsert({
    where: {
      workspaceId_queueId: {
        workspaceId: input.workspaceId,
        queueId: input.queueId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      queueId: input.queueId,
      lastAssignedTeamMemberId: selected?.id ?? null,
      assignmentSequence: 1n,
      lastAssignedAt: selected ? input.routedAt : null,
      updatedByActorId: input.actorId,
    },
    update: {
      ...(selected
        ? {
            lastAssignedTeamMemberId: selected.id,
            lastAssignedAt: input.routedAt,
          }
        : {}),
      assignmentSequence: { increment: 1n },
      updatedByActorId: input.actorId,
    },
  });

  return selected
    ? { type: "MEMBER", memberId: selected.workspaceMemberId, queueId: null }
    : { type: "QUEUE", memberId: null, queueId: input.queueId };
}

export async function createInitialLeadOperations(
  transaction: Prisma.TransactionClient,
  input: InitialArtifactsInput,
): Promise<Readonly<{ slaCycleId: string; taskId: string }>> {
  const assignmentType =
    input.owner.type === "MEMBER"
      ? "AUTOMATIC_ROUND_ROBIN"
      : "GENERAL_QUEUE_FALLBACK";

  const assignment = await transaction.leadAssignment.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      fromMemberId: input.previousOwner?.memberId ?? null,
      fromQueueId: input.previousOwner?.queueId ?? null,
      toMemberId: input.owner.memberId,
      toQueueId: input.owner.queueId,
      type: assignmentType,
      reason:
        input.owner.type === "MEMBER"
          ? "Distribuição automática por round-robin."
          : "Nenhum SDR ativo e disponível no momento da entrada.",
      assignedAt: input.receivedAt,
      createdByActorId: input.actorId,
    },
  });

  await projectLeadOwnership(transaction, {
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    memberId: input.owner.memberId,
    queueId: input.owner.queueId,
    actorId: input.actorId,
    occurredAt: input.receivedAt,
    sourceEntityId: assignment.id,
  });

  const slaCycle = await transaction.leadSlaCycle.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      submissionId: input.submissionId,
      priorityBandId: input.priorityBandId,
      assignedMemberId: input.owner.memberId,
      assignedQueueId: input.owner.queueId,
      receivedAt: input.receivedAt,
      assignedAt: input.receivedAt,
      automaticAcknowledgedAt: input.receivedAt,
      createdByActorId: input.actorId,
    },
    select: { id: true },
  });

  const task = await transaction.task.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      slaCycleId: slaCycle.id,
      assigneeMemberId: input.owner.memberId,
      queueId: input.owner.queueId,
      title: "Ligar agora",
      description: input.doNotContact
        ? "Contato bloqueado: o lead está marcado como não contatar."
        : "Primeira tentativa humana do SLA imediato.",
      kind: "IMMEDIATE_CALL",
      status: input.doNotContact ? "CANCELLED" : "OPEN",
      priority: input.priority,
      dueAt: input.receivedAt,
      completedAt: null,
      result: input.doNotContact
        ? "Contato bloqueado pelo estado não contatar."
        : null,
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      priority: true,
      dueAt: true,
    },
  });

  const reviewTask = input.doNotContact
    ? await transaction.task.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: input.leadId,
          assigneeMemberId: input.owner.memberId,
          queueId: input.owner.queueId,
          title: "Revisar restrição de contato",
          description:
            "Definir uma ação permitida sem remover silenciosamente o opt-out.",
          kind: "GENERAL",
          status: "OPEN",
          priority: input.priority,
          dueAt: input.receivedAt,
          createdByActorId: input.actorId,
          updatedByActorId: input.actorId,
        },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          priority: true,
          dueAt: true,
        },
      })
    : null;
  const nextTask = reviewTask ?? task;

  await transaction.lead.update({
    where: { id: input.leadId },
    data: {
      nextActionTaskId: nextTask.id,
      nextActionAt: nextTask.dueAt,
      nextActionDescription: nextTask.title,
      updatedByActorId: input.actorId,
    },
  });

  await transaction.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      type: "RESPONSIBLE_CHANGE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject:
        input.owner.type === "MEMBER"
          ? "Lead atribuído por round-robin"
          : "Lead enviado à Fila Geral",
      description:
        input.owner.type === "MEMBER"
          ? "Responsável definido automaticamente na entrada."
          : "Nenhum SDR ativo e disponível no momento da entrada.",
      occurredAt: input.receivedAt,
      nextActionAt: nextTask.dueAt,
      nextActionDescription: nextTask.title,
      previousValues: {
        memberId: input.previousOwner?.memberId ?? null,
        queueId: input.previousOwner?.queueId ?? null,
      },
      newValues: {
        memberId: input.owner.memberId,
        queueId: input.owner.queueId,
      },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
  });

  for (const createdTask of reviewTask ? [task, reviewTask] : [task]) {
    await transaction.activity.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        type: "TASK",
        direction: "INTERNAL",
        result:
          createdTask.status === "CANCELLED" ? "CANCELLED" : "INFORMATION",
        subject: `Tarefa criada: ${createdTask.title}`,
        occurredAt: input.receivedAt,
        nextActionAt: nextTask.dueAt,
        nextActionDescription: nextTask.title,
        newValues: {
          taskId: createdTask.id,
          kind: createdTask.kind,
          status: createdTask.status,
          priority: createdTask.priority,
          dueAt: createdTask.dueAt.toISOString(),
        },
        createdByActorId: input.actorId,
        updatedByActorId: input.actorId,
      },
    });
  }

  if (input.owner.type === "QUEUE") {
    const existingAlert = await transaction.operationalAlert.findFirst({
      where: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        type: "GENERAL_QUEUE_ASSIGNMENT",
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!existingAlert) {
      await transaction.operationalAlert.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: input.leadId,
          queueId: input.owner.queueId,
          type: "GENERAL_QUEUE_ASSIGNMENT",
          title: "Lead aguardando responsável",
          message:
            "A entrada foi encaminhada explicitamente à Fila Geral porque não havia SDR disponível.",
          createdByActorId: input.actorId,
        },
      });
    }
  }

  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action:
        input.owner.type === "MEMBER"
          ? "lead.assignment.round_robin"
          : "lead.assignment.general_queue",
      entityType: "Lead",
      entityId: input.leadId,
      occurredAt: input.receivedAt,
      requestId: input.requestId,
      changes: {
        toMemberId: input.owner.memberId,
        toQueueId: input.owner.queueId,
        slaCycleId: slaCycle.id,
        taskId: task.id,
        nextActionTaskId: nextTask.id,
      },
      metadata: { assignmentType },
    },
  });

  return { slaCycleId: slaCycle.id, taskId: task.id };
}
