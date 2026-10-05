import type {
  ActivityResult,
  ActivityType,
  LeadPriority,
  LeadStatus,
  Prisma,
  PrismaClient,
  TaskKind,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { scheduleNoAnswerCadenceInTransaction } from "@/modules/automations/application/lifecycle-automation-scheduler";
import type {
  InternalAutomationEvent,
  PublicationResult,
} from "@/modules/automations/domain/automation-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { assertContactAllowedInTransaction } from "@/modules/privacy/application/privacy-service";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

export type OperationalActorContext =
  | AuthenticatedContext
  | ServiceActorContext;

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type OperationalHistoryServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  automationPublisher?: Readonly<{
    publishInTransaction: (
      transaction: Prisma.TransactionClient,
      event: InternalAutomationEvent,
    ) => Promise<PublicationResult>;
  }>;
  beforeCommit?: () => Promise<void>;
}>;

const activityTypes = [
  "CALL",
  "CALL_CONNECTED",
  "CALL_UNANSWERED",
  "EMAIL",
  "MESSAGE",
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "AUDIO",
  "MEETING",
  "NOTE",
  "TASK",
  "STAGE_CHANGE",
  "RESPONSIBLE_CHANGE",
  "STATUS_CHANGE",
  "AUTOMATION",
  "AI_ACTION",
  "PROPOSAL",
  "WON",
  "LOST",
  "OTHER",
] as const satisfies readonly ActivityType[];

const activityResults = [
  "CONNECTED",
  "NOT_CONNECTED",
  "SENT",
  "RECEIVED",
  "COMPLETED",
  "CANCELLED",
  "SCHEDULED",
  "NO_SHOW",
  "WON",
  "LOST",
  "INFORMATION",
  "CORRECTED",
  "OTHER",
] as const satisfies readonly ActivityResult[];

const taskKinds = [
  "GENERAL",
  "IMMEDIATE_CALL",
  "CALL",
  "MESSAGE",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
] as const satisfies readonly TaskKind[];

const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const satisfies readonly LeadPriority[];

const nextTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2_000).optional(),
    kind: z.enum(taskKinds).default("GENERAL"),
    priority: z.enum(priorities).default("MEDIUM"),
    dueAt: z.coerce.date(),
  })
  .strict();

const createTaskSchema = nextTaskSchema.extend({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
});

const completeTaskSchema = z
  .object({
    leadId: z.string().uuid(),
    taskId: z.string().uuid(),
    result: z.string().trim().min(2).max(2_000),
    completedAt: z.coerce.date().optional(),
    nextTask: nextTaskSchema.optional(),
  })
  .strict();

const recordActivitySchema = z
  .object({
    leadId: z.string().uuid(),
    opportunityId: z.string().uuid().optional(),
    meetingId: z.string().uuid().optional(),
    type: z.enum(activityTypes),
    direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL"]).default("INTERNAL"),
    result: z.enum(activityResults).optional(),
    subject: z.string().trim().min(2).max(200),
    observation: z.string().trim().max(5_000).optional(),
    occurredAt: z.coerce.date().optional(),
    durationSeconds: z.number().int().positive().max(86_400).optional(),
    previousValues: z.record(z.string(), z.json()).optional(),
    newValues: z.record(z.string(), z.json()).optional(),
    nextTask: nextTaskSchema.optional(),
  })
  .strict();

const correctionSchema = z
  .object({
    leadId: z.string().uuid(),
    activityId: z.string().uuid(),
    reason: z.string().trim().min(3).max(2_000),
    correctedSubject: z.string().trim().min(2).max(200),
    correctedObservation: z.string().trim().max(5_000).optional(),
    correctedResult: z.enum(activityResults).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict();

const operationsQuerySchema = z
  .object({
    leadId: z.string().uuid(),
    cursor: z.string().uuid().optional(),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();

const updateLeadSummarySchema = z
  .object({
    leadId: z.string().uuid(),
    expectedUpdatedAt: z.coerce.date(),
    fullName: z.string().trim().min(2).max(200),
    normalizedEmail: z.string().trim().email().max(320).nullable(),
    jobTitle: z.string().trim().min(1).max(200).nullable(),
    organizationName: z.string().trim().min(1).max(200).nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    stateCode: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable(),
    interestSummary: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

type LeadForOperation = Readonly<{
  id: string;
  status: LeadStatus;
  ownerMemberId: string | null;
  queueId: string | null;
  routingQueueId: string | null;
  contactPreference: "UNKNOWN" | "CONSENTED" | "NOT_CONSENTED" | "DO_NOT_CONTACT";
  firstRespondedAt: Date | null;
  lastInboundResponseAt: Date | null;
  awaitingHumanResponse: boolean;
  lastActivityAt: Date;
  routingQueue: { teamId: string | null } | null;
  queue: { teamId: string | null } | null;
}>;

type NextTaskInput = z.output<typeof nextTaskSchema>;

function isHumanContext(
  context: OperationalActorContext,
): context is AuthenticatedContext {
  return "memberId" in context;
}

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(
    error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

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

function requiresNextAction(status: LeadStatus): boolean {
  return status !== "DISQUALIFIED" && status !== "CONVERTED" && status !== "LOST";
}

function resourceForLead(
  workspaceId: string,
  lead: Pick<LeadForOperation, "id" | "ownerMemberId" | "queueId" | "routingQueue" | "queue">,
): ResourceScope {
  return {
    workspaceId,
    resourceType: "Lead",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
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

async function getTransactionalLead(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
): Promise<LeadForOperation> {
  const lead = await transaction.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      status: true,
      ownerMemberId: true,
      queueId: true,
      routingQueueId: true,
      contactPreference: true,
      firstRespondedAt: true,
      lastInboundResponseAt: true,
      awaitingHumanResponse: true,
      lastActivityAt: true,
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
    },
  });
  if (!lead) notFound("Lead não encontrado.");
  return lead;
}

async function findNextTask(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
) {
  return transaction.task.findFirst({
    where: {
      workspaceId,
      leadId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
}

function taskProjection(nextTask: Awaited<ReturnType<typeof findNextTask>>) {
  return nextTask
    ? {
        nextActionTaskId: nextTask.id,
        nextActionAt: nextTask.dueAt,
        nextActionDescription: nextTask.title,
      }
    : {
        nextActionTaskId: null,
        nextActionAt: null,
        nextActionDescription: null,
      };
}

function inferredResult(
  type: ActivityType,
  supplied: ActivityResult | undefined,
): ActivityResult | null {
  const forced: Partial<Record<ActivityType, ActivityResult>> = {
    CALL_CONNECTED: "CONNECTED",
    CALL_UNANSWERED: "NOT_CONNECTED",
    MESSAGE_SENT: "SENT",
    MESSAGE_RECEIVED: "RECEIVED",
    WON: "WON",
    LOST: "LOST",
  };
  const expected = forced[type];
  if (expected && supplied && supplied !== expected) {
    conflict(
      "ACTIVITY_RESULT_MISMATCH",
      "O resultado informado não corresponde ao tipo de atividade.",
    );
  }
  if (type === "CALL" && supplied !== "CONNECTED" && supplied !== "NOT_CONNECTED") {
    conflict(
      "CALL_RESULT_REQUIRED",
      "Uma ligação exige resultado conectado ou não atendido.",
    );
  }
  return expected ?? supplied ?? null;
}

function isHumanAttempt(type: ActivityType): boolean {
  return type === "CALL" || type === "CALL_CONNECTED" || type === "CALL_UNANSWERED";
}

function isConnected(type: ActivityType, result: ActivityResult | null): boolean {
  return type === "CALL_CONNECTED" || (type === "CALL" && result === "CONNECTED");
}

function isInboundResponse(type: ActivityType): boolean {
  return type === "MESSAGE_RECEIVED";
}

async function assertReferences(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    opportunityId?: string;
    meetingId?: string;
  }>,
): Promise<void> {
  if (input.opportunityId) {
    const opportunity = await transaction.opportunity.findFirst({
      where: {
        id: input.opportunityId,
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!opportunity) notFound("Oportunidade não encontrada para este lead.");
  }
  if (input.meetingId) {
    const meeting = await transaction.meeting.findFirst({
      where: {
        id: input.meetingId,
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!meeting) notFound("Reunião não encontrada para este lead.");
  }
}

async function createTaskRecord(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    lead: LeadForOperation;
    actorId: string;
    task: NextTaskInput;
    opportunityId?: string;
    meetingId?: string;
    createdAt: Date;
  }>,
) {
  return transaction.task.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.lead.id,
      ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
      ...(input.meetingId ? { meetingId: input.meetingId } : {}),
      assigneeMemberId: input.lead.ownerMemberId,
      queueId: input.lead.queueId,
      title: input.task.title,
      ...(input.task.description ? { description: input.task.description } : {}),
      kind: input.task.kind,
      status: "OPEN",
      priority: input.task.priority,
      dueAt: input.task.dueAt,
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
    select: {
      id: true,
      title: true,
      description: true,
      kind: true,
      priority: true,
      dueAt: true,
    },
  });
}

async function createTaskHistory(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    actorId: string;
    task: Awaited<ReturnType<typeof createTaskRecord>>;
    occurredAt: Date;
    nextTask: Awaited<ReturnType<typeof findNextTask>>;
  }>,
): Promise<void> {
  await transaction.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      type: "TASK",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: `Tarefa criada: ${input.task.title}`,
      description: input.task.description,
      occurredAt: input.occurredAt,
      nextActionAt: input.nextTask?.dueAt ?? null,
      nextActionDescription: input.nextTask?.title ?? null,
      newValues: {
        taskId: input.task.id,
        kind: input.task.kind,
        priority: input.task.priority,
        dueAt: input.task.dueAt.toISOString(),
        status: "OPEN",
      },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  });
  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "task.created",
      entityType: "Task",
      entityId: input.task.id,
      occurredAt: input.occurredAt,
      changes: {
        leadId: input.leadId,
        title: input.task.title,
        kind: input.task.kind,
        priority: input.task.priority,
        dueAt: input.task.dueAt.toISOString(),
      },
    },
  });
}

async function applyContactFacts(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    lead: LeadForOperation;
    actorId: string;
    type: ActivityType;
    result: ActivityResult | null;
    occurredAt: Date;
  }>,
) {
  if (!isHumanAttempt(input.type) && !isInboundResponse(input.type)) {
    return {
      firstHumanAttemptRecorded: false,
      firstConnectedRecorded: false,
    };
  }

  if (isHumanAttempt(input.type)) {
    await assertContactAllowedInTransaction(transaction, {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      leadId: input.lead.id,
      channel: input.type === "EMAIL" ? "EMAIL" : "PHONE",
      intendedAction: input.type,
    });
  }

  const cycles = await transaction.leadSlaCycle.findMany({
    where: {
      workspaceId: input.workspaceId,
      leadId: input.lead.id,
      receivedAt: { lte: input.occurredAt },
    },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      receivedAt: true,
      firstHumanAttemptAt: true,
      firstConnectedAt: true,
    },
  });
  if (cycles.length === 0) {
    conflict(
      "SLA_CYCLE_UNAVAILABLE",
      "Não existe ciclo de SLA elegível para este horário.",
    );
  }

  const connected = isConnected(input.type, input.result) || isInboundResponse(input.type);
  const attempt = isHumanAttempt(input.type);
  let firstHumanAttemptRecorded = false;
  let firstConnectedRecorded = false;
  const completedCycleIds: string[] = [];

  for (const cycle of cycles) {
    if (connected && cycle.firstHumanAttemptAt && input.occurredAt < cycle.firstHumanAttemptAt) {
      conflict(
        "INVALID_ATTEMPT_TIME",
        "A conexão não pode ocorrer antes da primeira tentativa já registrada.",
      );
    }
    const data: Prisma.LeadSlaCycleUpdateInput = {};
    if (attempt && !cycle.firstHumanAttemptAt) {
      data.firstHumanAttemptAt = input.occurredAt;
      data.firstHumanAttemptSeconds = Math.floor(
        (input.occurredAt.getTime() - cycle.receivedAt.getTime()) / 1_000,
      );
      firstHumanAttemptRecorded = true;
      completedCycleIds.push(cycle.id);
    }
    if (connected && !cycle.firstConnectedAt) {
      data.firstConnectedAt = input.occurredAt;
      data.firstResponseTimeSeconds = Math.floor(
        (input.occurredAt.getTime() - cycle.receivedAt.getTime()) / 1_000,
      );
      firstConnectedRecorded = true;
    }
    if (Object.keys(data).length > 0) {
      await transaction.leadSlaCycle.update({ where: { id: cycle.id }, data });
    }
  }

  if (completedCycleIds.length > 0) {
    await transaction.task.updateMany({
      where: {
        workspaceId: input.workspaceId,
        slaCycleId: { in: completedCycleIds },
        kind: "IMMEDIATE_CALL",
        status: { in: ["OPEN", "IN_PROGRESS"] },
        deletedAt: null,
      },
      data: {
        status: "COMPLETED",
        completedAt: input.occurredAt,
        result:
          input.result === "CONNECTED"
            ? "Ligação atendida."
            : "Tentativa humana registrada.",
        updatedByActorId: input.actorId,
      },
    });
  }

  return { firstHumanAttemptRecorded, firstConnectedRecorded };
}

export function createOperationalHistoryService(
  options: OperationalHistoryServiceOptions,
) {
  async function getLead(
    workspaceId: string,
    leadId: string,
  ): Promise<LeadForOperation> {
    const lead = await options.database.lead.findFirst({
      where: { id: leadId, workspaceId, deletedAt: null },
      select: {
        id: true,
        status: true,
        ownerMemberId: true,
        queueId: true,
        routingQueueId: true,
        contactPreference: true,
        firstRespondedAt: true,
        lastInboundResponseAt: true,
        awaitingHumanResponse: true,
        lastActivityAt: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    return lead;
  }

  async function authorize(
    context: OperationalActorContext,
    lead: LeadForOperation,
    permission: PermissionKey,
  ): Promise<void> {
    if (isHumanContext(context)) {
      await options.authorization.assertAuthorized(
        context,
        permission,
        resourceForLead(context.workspaceId, lead),
      );
      return;
    }
    const actor = await options.database.actor.findFirst({
      where: {
        id: context.actorId,
        workspaceId: context.workspaceId,
        type: context.actorType,
        key: context.actorKey,
        userId: null,
      },
      select: { id: true },
    });
    if (!actor) {
      throw new ApplicationError("Ator automático inválido.", {
        code: "INVALID_SERVICE_ACTOR",
        statusCode: 403,
        expose: true,
      });
    }
  }

  async function createTask(
    context: OperationalActorContext,
    payload: unknown,
  ) {
    const parsed = createTaskSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await authorize(context, lead, PermissionKeys.TASKS_WRITE);
    const occurredAt = options.now();

    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const currentLead = await getTransactionalLead(
        transaction,
        context.workspaceId,
        lead.id,
      );
      await assertReferences(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        ...(parsed.data.opportunityId
          ? { opportunityId: parsed.data.opportunityId }
          : {}),
        ...(parsed.data.meetingId ? { meetingId: parsed.data.meetingId } : {}),
      });
      const task = await createTaskRecord(transaction, {
        workspaceId: context.workspaceId,
        lead: currentLead,
        actorId: context.actorId,
        task: parsed.data,
        ...(parsed.data.opportunityId
          ? { opportunityId: parsed.data.opportunityId }
          : {}),
        ...(parsed.data.meetingId ? { meetingId: parsed.data.meetingId } : {}),
        createdAt: occurredAt,
      });
      const nextTask = await findNextTask(transaction, context.workspaceId, lead.id);
      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          ...taskProjection(nextTask),
          ...(occurredAt > currentLead.lastActivityAt
            ? { lastActivityAt: occurredAt }
            : {}),
          updatedByActorId: context.actorId,
        },
      });
      await createTaskHistory(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        actorId: context.actorId,
        task,
        occurredAt,
        nextTask,
      });
      await options.beforeCommit?.();
      return Object.freeze({
        id: task.id,
        leadId: lead.id,
        title: task.title,
        dueAt: task.dueAt.toISOString(),
        status: "OPEN" as const,
      });
    });
  }

  async function completeTask(
    context: OperationalActorContext,
    payload: unknown,
  ) {
    const parsed = completeTaskSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await authorize(context, lead, PermissionKeys.TASKS_WRITE);
    const completedAt = parsed.data.completedAt ?? options.now();

    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const currentLead = await getTransactionalLead(
        transaction,
        context.workspaceId,
        lead.id,
      );
      const task = await transaction.task.findFirst({
        where: {
          id: parsed.data.taskId,
          workspaceId: context.workspaceId,
          leadId: lead.id,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          dueAt: true,
          opportunityId: true,
          meetingId: true,
        },
      });
      if (!task) notFound("Tarefa não encontrada.");
      if (task.kind === "IMMEDIATE_CALL") {
        conflict(
          "CONTACT_ACTIVITY_REQUIRED",
          "A tarefa Ligar agora deve ser concluída pelo registro da ligação.",
        );
      }
      if (task.status === "COMPLETED" || task.status === "CANCELLED") {
        conflict("TASK_ALREADY_CLOSED", "A tarefa já está encerrada.");
      }

      let createdNextTask: Awaited<ReturnType<typeof createTaskRecord>> | null = null;
      if (parsed.data.nextTask) {
        createdNextTask = await createTaskRecord(transaction, {
          workspaceId: context.workspaceId,
          lead: currentLead,
          actorId: context.actorId,
          task: parsed.data.nextTask,
          ...(task.opportunityId ? { opportunityId: task.opportunityId } : {}),
          ...(task.meetingId ? { meetingId: task.meetingId } : {}),
          createdAt: completedAt,
        });
      }

      await transaction.task.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          completedAt,
          result: parsed.data.result,
          updatedByActorId: context.actorId,
        },
      });
      const nextTask = await findNextTask(transaction, context.workspaceId, lead.id);
      if (requiresNextAction(currentLead.status) && !nextTask) {
        conflict(
          "NEXT_ACTION_REQUIRED",
          "Lead aberto precisa de uma próxima ação antes de concluir esta tarefa.",
        );
      }

      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          ...taskProjection(nextTask),
          ...(completedAt > currentLead.lastActivityAt
            ? { lastActivityAt: completedAt }
            : {}),
          updatedByActorId: context.actorId,
        },
      });
      if (createdNextTask) {
        await createTaskHistory(transaction, {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          actorId: context.actorId,
          task: createdNextTask,
          occurredAt: completedAt,
          nextTask,
        });
      }
      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          ...(task.opportunityId ? { opportunityId: task.opportunityId } : {}),
          ...(task.meetingId ? { meetingId: task.meetingId } : {}),
          type: "TASK",
          direction: "INTERNAL",
          result: "COMPLETED",
          subject: `Tarefa concluída: ${task.title}`,
          description: parsed.data.result,
          occurredAt: completedAt,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues: { taskId: task.id, status: task.status },
          newValues: {
            taskId: task.id,
            status: "COMPLETED",
            completedAt: completedAt.toISOString(),
            result: parsed.data.result,
          },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: completedAt,
          updatedAt: completedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "task.completed",
          entityType: "Task",
          entityId: task.id,
          occurredAt: completedAt,
          changes: {
            fromStatus: task.status,
            toStatus: "COMPLETED",
            result: parsed.data.result,
            nextTaskId: createdNextTask?.id ?? null,
          },
        },
      });
      await options.beforeCommit?.();
      return Object.freeze({
        id: task.id,
        leadId: lead.id,
        status: "COMPLETED" as const,
        completedAt: completedAt.toISOString(),
        nextTaskId: createdNextTask?.id ?? null,
      });
    });
  }

  async function recordActivity(
    context: OperationalActorContext,
    payload: unknown,
  ) {
    const parsed = recordActivitySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await authorize(context, lead, PermissionKeys.LEADS_WRITE);
    const occurredAt = parsed.data.occurredAt ?? options.now();
    const result = inferredResult(parsed.data.type, parsed.data.result);

    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const currentLead = await getTransactionalLead(
        transaction,
        context.workspaceId,
        lead.id,
      );
      await assertReferences(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        ...(parsed.data.opportunityId
          ? { opportunityId: parsed.data.opportunityId }
          : {}),
        ...(parsed.data.meetingId ? { meetingId: parsed.data.meetingId } : {}),
      });

      let createdNextTask: Awaited<ReturnType<typeof createTaskRecord>> | null = null;
      if (parsed.data.nextTask) {
        createdNextTask = await createTaskRecord(transaction, {
          workspaceId: context.workspaceId,
          lead: currentLead,
          actorId: context.actorId,
          task: parsed.data.nextTask,
          ...(parsed.data.opportunityId
            ? { opportunityId: parsed.data.opportunityId }
            : {}),
          ...(parsed.data.meetingId ? { meetingId: parsed.data.meetingId } : {}),
          createdAt: occurredAt,
        });
      }

      const contactFacts = await applyContactFacts(transaction, {
        workspaceId: context.workspaceId,
        lead: currentLead,
        actorId: context.actorId,
        type: parsed.data.type,
        result,
        occurredAt,
      });
      const nextTask = await findNextTask(transaction, context.workspaceId, lead.id);
      if (requiresNextAction(currentLead.status) && !nextTask) {
        conflict(
          "NEXT_ACTION_REQUIRED",
          "Lead aberto precisa de uma próxima ação. Informe a tarefa seguinte.",
        );
      }

      const responseRecorded = isConnected(parsed.data.type, result) || isInboundResponse(parsed.data.type);
      const inboundResponse = isInboundResponse(parsed.data.type);
      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          ...taskProjection(nextTask),
          ...(occurredAt > currentLead.lastActivityAt
            ? { lastActivityAt: occurredAt }
            : {}),
          ...(responseRecorded &&
          (!currentLead.firstRespondedAt || occurredAt < currentLead.firstRespondedAt)
            ? { firstRespondedAt: occurredAt }
            : {}),
          ...(inboundResponse &&
          (!currentLead.lastInboundResponseAt || occurredAt > currentLead.lastInboundResponseAt)
            ? {
                lastInboundResponseAt: occurredAt,
                awaitingHumanResponse: true,
              }
            : {}),
          ...(parsed.data.type === "MESSAGE_SENT" &&
          currentLead.lastInboundResponseAt &&
          occurredAt >= currentLead.lastInboundResponseAt
            ? { awaitingHumanResponse: false }
            : {}),
          updatedByActorId: context.actorId,
        },
      });
      if (createdNextTask) {
        await createTaskHistory(transaction, {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          actorId: context.actorId,
          task: createdNextTask,
          occurredAt,
          nextTask,
        });
      }
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          ...(parsed.data.opportunityId
            ? { opportunityId: parsed.data.opportunityId }
            : {}),
          ...(parsed.data.meetingId ? { meetingId: parsed.data.meetingId } : {}),
          type: parsed.data.type,
          direction: parsed.data.direction,
          result,
          subject: parsed.data.subject,
          ...(parsed.data.observation
            ? { description: parsed.data.observation }
            : {}),
          occurredAt,
          ...(parsed.data.durationSeconds
            ? { durationSeconds: parsed.data.durationSeconds }
            : {}),
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          ...(parsed.data.previousValues
            ? { previousValues: parsed.data.previousValues }
            : {}),
          ...(parsed.data.newValues ? { newValues: parsed.data.newValues } : {}),
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "activity.recorded",
          entityType: "Activity",
          entityId: activity.id,
          occurredAt,
          changes: {
            leadId: lead.id,
            type: parsed.data.type,
            result,
            nextTaskId: createdNextTask?.id ?? null,
            firstHumanAttemptRecorded: contactFacts.firstHumanAttemptRecorded,
            firstConnectedRecorded: contactFacts.firstConnectedRecorded,
          },
        },
      });
      if (inboundResponse && options.automationPublisher) {
        await options.automationPublisher.publishInTransaction(transaction, {
          workspaceId: context.workspaceId,
          triggerType: "LEAD_UPDATED",
          idempotencyKey: `lead-replied:${activity.id}`,
          occurredAt,
          triggeredByActorId: context.actorId,
          priority: 100,
          payload: {
            eventType: "LEAD_REPLIED",
            leadId: lead.id,
            activityId: activity.id,
          },
        });
      }
      if (parsed.data.type === "CALL_UNANSWERED" && options.automationPublisher) {
        await scheduleNoAnswerCadenceInTransaction(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            activityId: activity.id,
            occurredAt,
            actorId: context.actorId,
          },
        );
      }
      await options.beforeCommit?.();
      return Object.freeze({
        id: activity.id,
        leadId: lead.id,
        type: parsed.data.type,
        result,
        occurredAt: occurredAt.toISOString(),
        nextTaskId: createdNextTask?.id ?? null,
        ...contactFacts,
      });
    });
  }

  async function updateLeadSummary(
    context: AuthenticatedContext,
    payload: unknown,
  ) {
    const parsed = updateLeadSummarySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await authorize(context, lead, PermissionKeys.LEADS_WRITE);
    const occurredAt = options.now();

    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const current = await transaction.lead.findFirst({
        where: {
          id: lead.id,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
        select: {
          id: true,
          fullName: true,
          normalizedEmail: true,
          jobTitle: true,
          organizationName: true,
          city: true,
          stateCode: true,
          interestSummary: true,
          latestInterestSummary: true,
          lastActivityAt: true,
          updatedAt: true,
        },
      });
      if (!current) notFound("Lead não encontrado.");
      if (current.updatedAt.getTime() !== parsed.data.expectedUpdatedAt.getTime()) {
        conflict(
          "LEAD_VERSION_CONFLICT",
          "Este lead foi alterado por outra pessoa. Recarregue os dados antes de salvar.",
        );
      }

      const normalizedEmail = parsed.data.normalizedEmail?.toLowerCase() ?? null;
      const jobTitle = parsed.data.jobTitle;
      const organizationName = parsed.data.organizationName;
      const city = parsed.data.city;
      const stateCode = parsed.data.stateCode?.toUpperCase() ?? null;
      const interestSummary = parsed.data.interestSummary;
      const previousValues: Record<string, string | null> = {
        fullName: current.fullName,
        normalizedEmail: current.normalizedEmail,
        jobTitle: current.jobTitle,
        organizationName: current.organizationName,
        city: current.city,
        stateCode: current.stateCode,
        interestSummary: current.interestSummary,
      };
      const newValues: Record<string, string | null> = {
        fullName: parsed.data.fullName,
        normalizedEmail,
        jobTitle,
        organizationName,
        city,
        stateCode,
        interestSummary,
      };
      const changedFields = Object.keys(newValues).filter(
        (field) => previousValues[field] !== newValues[field],
      );
      if (changedFields.length === 0) {
        conflict("NO_CHANGES", "Nenhuma alteração foi informada.");
      }

      const nextTask = await findNextTask(
        transaction,
        context.workspaceId,
        lead.id,
      );
      const updated = await transaction.lead.update({
        where: { id: lead.id },
        data: {
          fullName: parsed.data.fullName,
          normalizedEmail,
          jobTitle,
          organizationName,
          city,
          stateCode,
          interestSummary,
          latestInterestSummary: interestSummary,
          ...(occurredAt > current.lastActivityAt
            ? { lastActivityAt: occurredAt }
            : {}),
          updatedByActorId: context.actorId,
          updatedAt: occurredAt,
        },
        select: { updatedAt: true },
      });
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          type: "STATUS_CHANGE",
          direction: "INTERNAL",
          result: "INFORMATION",
          subject: "Resumo do lead atualizado",
          description: `Campos alterados: ${changedFields.join(", ")}.`,
          occurredAt,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues,
          newValues,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "lead.summary.updated",
          entityType: "Lead",
          entityId: lead.id,
          occurredAt,
          changes: { changedFields, activityId: activity.id },
        },
      });
      await options.beforeCommit?.();
      return Object.freeze({
        leadId: lead.id,
        updatedAt: updated.updatedAt.toISOString(),
        changedFields,
      });
    });
  }

  async function correctActivity(
    context: OperationalActorContext,
    payload: unknown,
  ) {
    const parsed = correctionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await authorize(context, lead, PermissionKeys.LEADS_WRITE);
    const occurredAt = parsed.data.occurredAt ?? options.now();

    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const original = await transaction.activity.findFirst({
        where: {
          id: parsed.data.activityId,
          workspaceId: context.workspaceId,
          leadId: lead.id,
        },
        select: {
          id: true,
          type: true,
          subject: true,
          description: true,
          result: true,
        },
      });
      if (!original) notFound("Atividade original não encontrada.");
      const nextTask = await findNextTask(transaction, context.workspaceId, lead.id);
      const correction = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          type: original.type,
          direction: "INTERNAL",
          result: "CORRECTED",
          subject: `Correção: ${parsed.data.correctedSubject}`,
          description: parsed.data.reason,
          occurredAt,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues: {
            subject: original.subject,
            description: original.description,
            result: original.result,
          },
          newValues: {
            subject: parsed.data.correctedSubject,
            description: parsed.data.correctedObservation ?? null,
            result: parsed.data.correctedResult ?? null,
          },
          correctsActivityId: original.id,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        select: { id: true },
      });
      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          ...(occurredAt > lead.lastActivityAt ? { lastActivityAt: occurredAt } : {}),
          updatedByActorId: context.actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "activity.corrected",
          entityType: "Activity",
          entityId: correction.id,
          occurredAt,
          changes: {
            correctsActivityId: original.id,
            reason: parsed.data.reason,
          },
        },
      });
      await options.beforeCommit?.();
      return Object.freeze({
        id: correction.id,
        correctsActivityId: original.id,
        occurredAt: occurredAt.toISOString(),
      });
    });
  }

  async function getLeadOperations(
    context: AuthenticatedContext,
    payload: unknown,
  ) {
    const parsed = operationsQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await getLead(context.workspaceId, parsed.data.leadId);
    await Promise.all([
      authorize(context, lead, PermissionKeys.LEADS_READ),
      authorize(context, lead, PermissionKeys.TASKS_READ),
    ]);
    const resource = resourceForLead(context.workspaceId, lead);
    const [writeDecision, taskWriteDecision, assignDecision, auditDecision] =
      await Promise.all([
        options.authorization.authorize(
          context,
          PermissionKeys.LEADS_WRITE,
          resource,
        ),
        options.authorization.authorize(
          context,
          PermissionKeys.TASKS_WRITE,
          resource,
        ),
        options.authorization.authorize(
          context,
          PermissionKeys.LEADS_ASSIGN,
          resource,
        ),
        options.authorization.authorize(
          context,
          PermissionKeys.AUDIT_READ,
          resource,
        ),
      ]);
    const cursorActivity = parsed.data.cursor
      ? await options.database.activity.findFirst({
          where: {
            id: parsed.data.cursor,
            workspaceId: context.workspaceId,
            leadId: lead.id,
          },
          select: { id: true },
        })
      : null;
    if (parsed.data.cursor && !cursorActivity) {
      notFound("Cursor da timeline não encontrado.");
    }
    const routingTeamId = lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null;

    const [workspace, publicLead, tasks, activities, assignmentTargets] =
      await Promise.all([
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      options.database.lead.findUniqueOrThrow({
        where: { id: lead.id },
        select: {
          id: true,
          updatedAt: true,
          createdAt: true,
          fullName: true,
          normalizedPhone: true,
          normalizedEmail: true,
          jobTitle: true,
          organizationName: true,
          account: { select: { id: true, name: true } },
          accountIdentityReviews: {
            where: { status: "OPEN" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true, reason: true, createdAt: true },
          },
          city: true,
          stateCode: true,
          interestSummary: true,
          latestInterestSummary: true,
          budgetCents: true,
          contactPreference: true,
          conversionCount: true,
          latestSubmissionAt: true,
          needsIdentityReview: true,
          status: true,
          nextActionTaskId: true,
          nextActionAt: true,
          nextActionDescription: true,
          awaitingHumanResponse: true,
          lastInboundResponseAt: true,
          owner: { select: { user: { select: { displayName: true } } } },
          queue: { select: { name: true } },
          currentStage: { select: { name: true } },
          latestSource: { select: { name: true } },
          source: { select: { name: true } },
          latestCampaign: { select: { name: true } },
          campaign: { select: { name: true } },
          latestCreative: { select: { name: true } },
          creative: { select: { name: true } },
          slaCycles: {
            orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              receivedAt: true,
              firstHumanAttemptAt: true,
              firstConnectedAt: true,
              firstHumanAttemptSeconds: true,
              firstResponseTimeSeconds: true,
              priorityBand: {
                select: {
                  code: true,
                  name: true,
                  slaPolicy: {
                    select: {
                      name: true,
                      healthyMaxSeconds: true,
                      attentionMaxSeconds: true,
                    },
                  },
                },
              },
            },
          },
          currentScore: {
            select: {
              leadScore: {
                select: {
                  score: true,
                  reason: true,
                  priorityBandCode: true,
                },
              },
            },
          },
          submissions: {
            orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              channel: true,
              submittedAt: true,
              submittedFullName: true,
              submittedEmail: true,
              submittedPhone: true,
              submittedJobTitle: true,
              submittedOrganizationName: true,
              submittedCity: true,
              submittedStateCode: true,
              submittedInterestSummary: true,
              submittedBudgetCents: true,
              submittedContactPreference: true,
              source: { select: { name: true } },
              campaign: { select: { name: true } },
              creative: { select: { name: true } },
            },
          },
          operationalAlerts: {
            where: { status: "OPEN" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, title: true, message: true, createdAt: true },
          },
          identityReviews: {
            where: { status: "OPEN" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, divergenceFields: true, createdAt: true },
          },
        },
      }),
      options.database.task.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          deletedAt: null,
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          title: true,
          description: true,
          kind: true,
          status: true,
          priority: true,
          dueAt: true,
          completedAt: true,
          result: true,
        },
      }),
      options.database.activity.findMany({
        where: { workspaceId: context.workspaceId, leadId: lead.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        ...(parsed.data.cursor
          ? { cursor: { id: parsed.data.cursor }, skip: 1 }
          : {}),
        take: parsed.data.pageSize + 1,
        select: {
          id: true,
          type: true,
          direction: true,
          result: true,
          subject: true,
          description: true,
          occurredAt: true,
          durationSeconds: true,
          nextActionAt: true,
          nextActionDescription: true,
          previousValues: true,
          newValues: true,
          correctsActivityId: true,
          createdBy: {
            select: { displayName: true, type: true },
          },
        },
      }),
      assignDecision.allowed
        ? options.database.workspaceMember.findMany({
            where: commercialMemberWhere({
              workspaceId: context.workspaceId,
              functions: ["SDR", "CLOSER"],
              requireLeadAvailability: true,
              ...(assignDecision.scope === "TEAM" && routingTeamId
                ? { teamIds: [routingTeamId] }
                : {}),
            }),
            orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
            select: { id: true, user: { select: { displayName: true } } },
          })
        : Promise.resolve([]),
    ]);
    const hasMore = activities.length > parsed.data.pageSize;
    const timeline = activities.slice(0, parsed.data.pageSize);
    const activeTasks = tasks.filter(
      (task) => task.status === "OPEN" || task.status === "IN_PROGRESS",
    );
    const now = options.now();
    const nextTask = activeTasks[0] ?? null;
    const projectionIsConsistent = Boolean(
      nextTask &&
        publicLead.nextActionTaskId === nextTask.id &&
        publicLead.nextActionAt?.getTime() === nextTask.dueAt.getTime() &&
        publicLead.nextActionDescription === nextTask.title,
    );

    const currentCycle = publicLead.slaCycles[0];
    if (!currentCycle) {
      conflict(
        "SLA_CYCLE_UNAVAILABLE",
        "O lead não possui um ciclo de SLA persistido.",
      );
    }
    const latestScore = publicLead.currentScore?.leadScore ?? null;
    const latestSubmission = publicLead.submissions[0] ?? null;
    const receivedAt = currentCycle.receivedAt;
    const elapsedSeconds =
      currentCycle.firstHumanAttemptSeconds ??
      Math.max(0, Math.floor((now.getTime() - receivedAt.getTime()) / 1_000));
    const interestSummary =
      publicLead.interestSummary ?? publicLead.latestInterestSummary;
    const missingFields = [
      !publicLead.normalizedEmail ? "E-mail" : null,
      !publicLead.jobTitle ? "Cargo ou atuação" : null,
      !publicLead.organizationName ? "Organização" : null,
      !publicLead.city ? "Cidade" : null,
      !publicLead.stateCode ? "Estado" : null,
      !interestSummary ? "Dor ou interesse" : null,
      publicLead.budgetCents === null ? "Capacidade ou orçamento" : null,
    ].filter((field): field is string => Boolean(field));
    const summaryAlerts = [
      ...publicLead.operationalAlerts.map((alert) => ({
        key: `operational:${alert.id}`,
        title: alert.title,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      })),
      ...publicLead.identityReviews.map((review) => ({
        key: `identity:${review.id}`,
        title: "Revisão de identidade pendente",
        message:
          review.divergenceFields.length > 0
            ? `Divergências: ${review.divergenceFields.join(", ")}.`
            : "Uma nova conversão precisa de revisão humana.",
        createdAt: review.createdAt.toISOString(),
      })),
    ];

    return Object.freeze({
      generatedAt: now.toISOString(),
      timeZone: workspace.timeZone,
      permissions: {
        canWrite: writeDecision.allowed,
        canManageTasks: taskWriteDecision.allowed,
        canAssign: assignDecision.allowed,
        canReadAudit: auditDecision.allowed,
      },
      assignmentTargets: assignmentTargets.map((member) => ({
        id: member.id,
        name: member.user.displayName,
      })),
      lead: {
        id: publicLead.id,
        updatedAt: publicLead.updatedAt.toISOString(),
        fullName: publicLead.fullName,
        normalizedPhone: publicLead.normalizedPhone,
        normalizedEmail: publicLead.normalizedEmail,
        jobTitle: publicLead.jobTitle,
        organizationName: publicLead.organizationName,
        account: publicLead.account,
        accountIdentityReview: publicLead.accountIdentityReviews[0]
          ? {
              id: publicLead.accountIdentityReviews[0].id,
              reason: publicLead.accountIdentityReviews[0].reason,
              createdAt: publicLead.accountIdentityReviews[0].createdAt.toISOString(),
            }
          : null,
        city: publicLead.city,
        stateCode: publicLead.stateCode,
        interestSummary,
        budgetCents: publicLead.budgetCents?.toString() ?? null,
        contactPreference: publicLead.contactPreference,
        status: publicLead.status,
        stageName: publicLead.currentStage.name,
        priorityCode: latestScore?.priorityBandCode ?? currentCycle.priorityBand.code,
        score: latestScore?.score ?? null,
        priorityReason: latestScore?.reason ?? currentCycle.priorityBand.name,
        operationalOwner:
          publicLead.owner?.user.displayName ??
          publicLead.queue?.name ??
          "Responsável operacional indisponível",
        ownerMemberId: lead.ownerMemberId,
        queueId: lead.queueId,
        sourceName: publicLead.latestSource?.name ?? publicLead.source.name,
        campaignName:
          publicLead.latestCampaign?.name ?? publicLead.campaign?.name ?? null,
        creativeName:
          publicLead.latestCreative?.name ?? publicLead.creative?.name ?? null,
        receivedAt: receivedAt.toISOString(),
        latestSubmissionAt: publicLead.latestSubmissionAt?.toISOString() ?? null,
        conversionCount: publicLead.conversionCount,
        needsIdentityReview: publicLead.needsIdentityReview,
        awaitingHumanResponse: publicLead.awaitingHumanResponse,
        lastInboundResponseAt:
          publicLead.lastInboundResponseAt?.toISOString() ?? null,
        sla: {
          policyName: currentCycle.priorityBand.slaPolicy.name,
          elapsedSeconds,
          healthyMaxSeconds:
            currentCycle.priorityBand.slaPolicy.healthyMaxSeconds,
          attentionMaxSeconds:
            currentCycle.priorityBand.slaPolicy.attentionMaxSeconds,
          firstHumanAttemptAt:
            currentCycle.firstHumanAttemptAt?.toISOString() ?? null,
          firstConnectedAt: currentCycle.firstConnectedAt?.toISOString() ?? null,
          firstHumanAttemptSeconds: currentCycle.firstHumanAttemptSeconds,
          firstResponseTimeSeconds: currentCycle.firstResponseTimeSeconds,
        },
        lastActivity: activities[0]
          ? {
              subject: activities[0].subject,
              occurredAt: activities[0].occurredAt.toISOString(),
            }
          : null,
        nextAction: nextTask
          ? {
              taskId: nextTask.id,
              title: nextTask.title,
              dueAt: nextTask.dueAt.toISOString(),
            }
          : null,
        nextActionIssue:
          requiresNextAction(publicLead.status) && !nextTask
            ? "Lead aberto sem próxima ação."
            : !projectionIsConsistent && nextTask
              ? "A projeção da próxima ação está inconsistente com as tarefas."
              : null,
      },
      summary: {
        latestSubmission: latestSubmission
          ? {
              channel: latestSubmission.channel,
              submittedAt: latestSubmission.submittedAt.toISOString(),
              fullName: latestSubmission.submittedFullName,
              email: latestSubmission.submittedEmail,
              phone: latestSubmission.submittedPhone,
              jobTitle: latestSubmission.submittedJobTitle,
              organizationName: latestSubmission.submittedOrganizationName,
              city: latestSubmission.submittedCity,
              stateCode: latestSubmission.submittedStateCode,
              interestSummary: latestSubmission.submittedInterestSummary,
              budgetCents:
                latestSubmission.submittedBudgetCents?.toString() ?? null,
              contactPreference: latestSubmission.submittedContactPreference,
              sourceName: latestSubmission.source.name,
              campaignName: latestSubmission.campaign?.name ?? null,
              creativeName: latestSubmission.creative?.name ?? null,
            }
          : null,
        alerts: summaryAlerts,
        missingFields,
      },
      tasks: tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
        overdue:
          (task.status === "OPEN" || task.status === "IN_PROGRESS") &&
          task.dueAt.getTime() < now.getTime(),
      })),
      timeline: timeline.map((activity) => ({
        ...activity,
        occurredAt: activity.occurredAt.toISOString(),
        nextActionAt: activity.nextActionAt?.toISOString() ?? null,
        actor: {
          name: activity.createdBy.displayName,
          type: activity.createdBy.type,
        },
        createdBy: undefined,
      })),
      nextCursor: hasMore ? timeline.at(-1)?.id ?? null : null,
    });
  }

  return Object.freeze({
    createTask,
    completeTask,
    recordActivity,
    updateLeadSummary,
    correctActivity,
    getLeadOperations,
  });
}

let operationalHistoryService:
  | ReturnType<typeof createOperationalHistoryService>
  | undefined;

export function getOperationalHistoryService() {
  operationalHistoryService ??= createOperationalHistoryService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
    automationPublisher: getAutomationEngineService(),
  });
  return operationalHistoryService;
}
