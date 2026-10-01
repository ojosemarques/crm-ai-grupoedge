import type {
  LeadPipelineStageCode,
  PipelineStage,
  Prisma,
  PrismaClient,
  StageTransitionOrigin,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import {
  publishLeadQualifiedInTransaction,
  type TransactionalAutomationPublisher,
} from "@/modules/automations/application/lifecycle-automation-scheduler";
import {
  leadVisibilityWhere,
  resolveLeadVisibilityScope,
} from "@/modules/leads/application/lead-list-service";
import {
  statusForLeadStage,
} from "@/modules/pipelines/domain/lead-stage-transition-policy";
import {
  leadStageCodes,
  type LeadPipelineCard,
  type LeadPipelineStagePage,
  type LeadPipelineState,
  type LeadStageCode,
  type PreSalesPipelineScreen,
  type StageTransitionOption,
} from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: ReturnType<typeof getAuthorizationService>["authorize"];
  assertAuthorized: ReturnType<typeof getAuthorizationService>["assertAuthorized"];
}>;

type PreSalesPipelineServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  automationPublisher?: TransactionalAutomationPublisher;
  beforeCommit?: () => Promise<void>;
}>;

const screenQuerySchema = z.object({
  pipelineId: z.union([z.literal(""), z.string().uuid()]).optional().default(""),
  q: z.string().trim().max(200).optional().default(""),
  responsible: z.string().trim().max(100).optional().default(""),
  priority: z.enum(["ALL", "P1", "P2", "P3"]).optional().default("ALL"),
  stageCode: z.enum(["ALL", ...leadStageCodes]).optional().default("ALL"),
}).strict();

const leadStateSchema = z.object({ leadId: z.string().uuid() }).strict();

const stagePageSchema = screenQuerySchema.extend({
  stageId: z.string().uuid(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

const expectedStageHours: Readonly<Partial<Record<LeadStageCode, number>>> = Object.freeze({
  NEW: 24,
  TRYING_CONTACT: 72,
  CONNECTED: 48,
  IN_QUALIFICATION: 72,
  QUALIFIED: 72,
  MEETING_SCHEDULED: 168,
  NURTURING: 720,
});
const staleHours = 72;
const conversionPeriodDays = 90;

const transitionSchema = z.object({
  leadId: z.string().uuid(),
  targetStageId: z.string().uuid(),
  expectedUpdatedAt: z.coerce.date(),
  reason: z.string().trim().max(1_000).optional().transform((value) => value || "Movido manualmente no pipeline."),
  origin: z.enum(["PIPELINE_BOARD", "PIPELINE_LIST", "LEAD_CARD"]),
  managerCorrection: z.boolean().optional().default(false),
  confirmed: z.boolean().optional().default(false),
  disqualificationReasonId: z.string().uuid().nullable().optional(),
}).strict();

type PipelineStageRecord = Pick<
  PipelineStage,
  "id" | "name" | "position" | "type" | "leadStageCode"
>;
function invalidInput(error: z.ZodError | string): never {
  throw new ApplicationError(
    typeof error === "string" ? error : error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function notFound(message: string): never {
  throw new ApplicationError(message, { code: "NOT_FOUND", statusCode: 404, expose: true });
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, { code, statusCode: 409, expose: true });
}

function isLeadStageCode(value: LeadPipelineStageCode | null): value is LeadStageCode {
  return value !== null && leadStageCodes.includes(value);
}

function assertCompleteLeadStages(stages: readonly PipelineStageRecord[]) {
  const configured = new Set(stages.flatMap((stage) => isLeadStageCode(stage.leadStageCode) ? [stage.leadStageCode] : []));
  const missing = leadStageCodes.filter((code) => !configured.has(code));
  if (missing.length > 0) {
    conflict(
      "PIPELINE_CONFIGURATION_INVALID",
      `O pipeline de pré-vendas está incompleto. Etapas ausentes: ${missing.join(", ")}.`,
    );
  }
}

function resourceForLead(
  workspaceId: string,
  lead: Readonly<{
    id: string;
    ownerMemberId: string | null;
    queueId: string | null;
    routingQueue: { teamId: string | null } | null;
    queue: { teamId: string | null } | null;
  }>,
): ResourceScope {
  return {
    workspaceId,
    resourceType: "LeadPipeline",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

function transitionOptions(
  stages: readonly PipelineStageRecord[],
  currentCode: LeadStageCode,
): StageTransitionOption[] {
  return stages.flatMap((stage) => {
    if (!isLeadStageCode(stage.leadStageCode) || stage.leadStageCode === currentCode) return [];
    const target = stage.leadStageCode;
    return [{
      stageId: stage.id,
      code: target,
      name: stage.name,
      allowed: true,
      correctionAllowed: true,
      blockReason: null,
      correctionBlockReason: null,
      requiresConfirmation: false,
      requiresDisqualificationReason: false,
    }];
  });
}

async function lockLead(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`lead-distribution:${workspaceId}:${leadId}`}, 0)
    )
  `;
}

function activeTaskWhere(workspaceId: string, leadId: string): Prisma.TaskWhereInput {
  return {
    workspaceId,
    leadId,
    status: { in: ["OPEN", "IN_PROGRESS"] },
    deletedAt: null,
  };
}

const pipelineCardInclude = {
  owner: { select: { user: { select: { displayName: true } } } },
  queue: { select: { name: true } },
  currentScore: { select: { leadScore: { select: { score: true, priorityBandCode: true } } } },
  tasks: {
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 1,
    select: { dueAt: true, title: true },
  },
  pactoRevisions: {
    where: { kind: "VALIDATED" },
    orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
    take: 1,
    select: { isQualificationReady: true },
  },
} satisfies Prisma.LeadInclude;

type PipelineCardRow = Prisma.LeadGetPayload<{ include: typeof pipelineCardInclude }>;

function toPipelineCard(lead: PipelineCardRow, stageName: string): LeadPipelineCard {
  const task = lead.tasks[0] ?? null;
  return {
    id: lead.id,
    fullName: lead.fullName,
    jobTitle: lead.jobTitle,
    priorityCode: lead.currentScore?.leadScore.priorityBandCode ?? null,
    score: lead.currentScore?.leadScore.score ?? null,
    responsibleName: lead.owner?.user.displayName ?? lead.queue?.name ?? "Responsável não identificado",
    currentStageName: stageName,
    nextActionAt: task?.dueAt.toISOString() ?? null,
    nextActionDescription: task?.title ?? null,
    pactoReady: lead.pactoRevisions[0]?.isQualificationReady ?? false,
  };
}

export type TransactionalLeadStageTransitionInput = Readonly<{
  leadId: string;
  targetStageId: string;
  expectedUpdatedAt?: Date;
  reason: string;
  origin: StageTransitionOrigin;
  managerCorrection: boolean;
  confirmed: boolean;
  disqualificationReasonId?: string | null;
}>;

export async function transitionLeadStageInTransaction(
  transaction: Prisma.TransactionClient,
  context: Pick<AuthenticatedContext, "workspaceId" | "actorId">,
  input: TransactionalLeadStageTransitionInput,
  requestedAt: Date,
) {
  await lockLead(transaction, context.workspaceId, input.leadId);
  const lead = await transaction.lead.findFirst({
    where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null },
    include: {
      currentStage: true,
      stageHistory: {
        where: { exitedAt: null },
        orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      tasks: {
        where: activeTaskWhere(context.workspaceId, input.leadId),
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, dueAt: true },
      },
      pactoRevisions: {
        where: { kind: "VALIDATED" },
        orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
        take: 1,
        select: { isQualificationReady: true },
      },
    },
  });
  if (!lead) notFound("Lead não encontrado.");
  if (input.expectedUpdatedAt && lead.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    conflict("LEAD_VERSION_CONFLICT", "Este lead mudou. Recarregue antes de alterar a etapa.");
  }
  if (!isLeadStageCode(lead.currentStage.leadStageCode)) {
    conflict("PIPELINE_CONFIGURATION_INVALID", "A etapa atual não possui código operacional de pré-vendas.");
  }
  const currentHistory = lead.stageHistory[0];
  if (!currentHistory || currentHistory.stageId !== lead.currentStageId) {
    conflict("STAGE_HISTORY_INCONSISTENT", "O histórico aberto não corresponde à etapa atual do lead.");
  }
  const target = await transaction.pipelineStage.findFirst({
    where: {
      id: input.targetStageId,
      workspaceId: context.workspaceId,
      pipelineId: lead.pipelineId,
      deletedAt: null,
      leadStageCode: { not: null },
    },
  });
  if (!target || !isLeadStageCode(target.leadStageCode)) notFound("Etapa de destino não encontrada.");
  if (target.id === lead.currentStageId) conflict("STAGE_UNCHANGED", "O lead já está nesta etapa.");
  let disqualificationReason: { id: string; name: string } | null = null;
  if (target.leadStageCode === "DISQUALIFIED" && input.disqualificationReasonId) {
    disqualificationReason = await transaction.disqualificationReason.findFirst({
      where: {
        id: input.disqualificationReasonId,
        workspaceId: context.workspaceId,
        active: true,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!disqualificationReason) notFound("Motivo de desqualificação não encontrado ou inativo.");
  }
  const occurredAt = requestedAt > currentHistory.enteredAt
    ? requestedAt
    : new Date(currentHistory.enteredAt.getTime() + 1);
  const cancelledTaskIds = target.leadStageCode === "DISQUALIFIED"
    ? lead.tasks.map((task) => task.id)
    : [];
  await transaction.stageHistory.update({
    where: { id: currentHistory.id },
    data: { exitedAt: occurredAt, exitedByActorId: context.actorId },
  });
  await transaction.stageHistory.create({
    data: {
      workspaceId: context.workspaceId,
      pipelineId: lead.pipelineId,
      stageId: target.id,
      leadId: lead.id,
      enteredAt: occurredAt,
      enteredByActorId: context.actorId,
      transitionOrigin: input.origin,
      transitionReason: input.reason,
      managerCorrection: input.managerCorrection,
    },
  });
  if (cancelledTaskIds.length > 0) {
    await transaction.task.updateMany({
      where: { id: { in: cancelledTaskIds }, workspaceId: context.workspaceId, leadId: lead.id },
      data: {
        status: "CANCELLED",
        result: "Cancelada pela desqualificação do lead.",
        updatedByActorId: context.actorId,
        updatedAt: occurredAt,
      },
    });
  }
  const nextTask = target.leadStageCode === "DISQUALIFIED" ? null : lead.tasks[0] ?? null;
  const status = statusForLeadStage(target.leadStageCode);
  const updated = await transaction.lead.update({
    where: { id: lead.id },
    data: {
      currentStageId: target.id,
      status,
      disqualificationReasonId: disqualificationReason?.id ?? null,
      nextActionTaskId: nextTask?.id ?? null,
      nextActionAt: nextTask?.dueAt ?? null,
      nextActionDescription: nextTask?.title ?? null,
      lastActivityAt: occurredAt > lead.lastActivityAt ? occurredAt : lead.lastActivityAt,
      updatedByActorId: context.actorId,
      updatedAt: occurredAt,
    },
    select: { updatedAt: true },
  });
  const activity = await transaction.activity.create({
    data: {
      workspaceId: context.workspaceId,
      leadId: lead.id,
      type: "STAGE_CHANGE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: input.managerCorrection
        ? `Correção gerencial de etapa: ${target.name}`
        : `Etapa alterada: ${target.name}`,
      description: input.reason,
      occurredAt,
      nextActionAt: nextTask?.dueAt ?? null,
      nextActionDescription: nextTask?.title ?? null,
      previousValues: {
        stageId: lead.currentStage.id,
        stageCode: lead.currentStage.leadStageCode,
        stageName: lead.currentStage.name,
        status: lead.status,
      },
      newValues: {
        stageId: target.id,
        stageCode: target.leadStageCode,
        stageName: target.name,
        status,
        disqualificationReasonId: disqualificationReason?.id ?? null,
        managerCorrection: input.managerCorrection,
      },
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
      action: input.managerCorrection ? "lead.stage.manager_corrected" : "lead.stage.transitioned",
      entityType: "Lead",
      entityId: lead.id,
      occurredAt,
      changes: {
        fromStageId: lead.currentStage.id,
        fromStageCode: lead.currentStage.leadStageCode,
        toStageId: target.id,
        toStageCode: target.leadStageCode,
        fromStatus: lead.status,
        toStatus: status,
        reason: input.reason,
        disqualificationReasonId: disqualificationReason?.id ?? null,
        cancelledTaskIds,
        activityId: activity.id,
      },
      metadata: {
        origin: input.origin,
        managerCorrection: input.managerCorrection,
      },
    },
  });
  return Object.freeze({
    leadId: lead.id,
    fromStageId: lead.currentStage.id,
    toStageId: target.id,
    toStageCode: target.leadStageCode,
    status,
    updatedAt: updated.updatedAt.toISOString(),
    occurredAt: occurredAt.toISOString(),
    cancelledTaskIds,
  });
}

export function createPreSalesPipelineService(options: PreSalesPipelineServiceOptions) {
  async function getPipeline(workspaceId: string, pipelineId = "") {
    const pipeline = await options.database.pipeline.findFirst({
      where: {
        workspaceId,
        entityType: "LEAD",
        deletedAt: null,
        ...(pipelineId ? { id: pipelineId } : { isDefault: true }),
      },
      include: {
        stages: {
          where: { deletedAt: null },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!pipeline) notFound(pipelineId ? "Pipeline de pré-vendas não encontrado." : "Pipeline padrão de pré-vendas não encontrado.");
    assertCompleteLeadStages(pipeline.stages);
    return pipeline;
  }

  async function getLeadForAuthorization(workspaceId: string, leadId: string) {
    const lead = await options.database.lead.findFirst({
      where: { id: leadId, workspaceId, deletedAt: null },
      select: {
        id: true,
        pipelineId: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    return lead;
  }

  async function capabilities(context: AuthenticatedContext, resource: ResourceScope) {
    const [write, correct] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource),
      options.authorization.authorize(context, PermissionKeys.LEADS_ASSIGN, resource),
    ]);
    return { canWrite: write.allowed, canCorrect: correct.allowed };
  }

  async function getLeadState(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<LeadPipelineState> {
    const parsed = leadStateSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const leadForAuth = await getLeadForAuthorization(context.workspaceId, parsed.data.leadId);
    const resource = resourceForLead(context.workspaceId, leadForAuth);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, resource);
    const [pipeline, lead, permission, reasons] = await Promise.all([
      getPipeline(context.workspaceId, leadForAuth.pipelineId),
      options.database.lead.findUniqueOrThrow({
        where: { id: leadForAuth.id },
        include: {
          currentStage: true,
          tasks: {
            where: activeTaskWhere(context.workspaceId, leadForAuth.id),
            orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { id: true },
          },
          pactoRevisions: {
            where: { kind: "VALIDATED" },
            orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
            take: 1,
            select: { isQualificationReady: true },
          },
          stageHistory: {
            where: { exitedAt: null },
            orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { enteredAt: true },
          },
        },
      }),
      capabilities(context, resource),
      options.database.disqualificationReason.findMany({
        where: { workspaceId: context.workspaceId, active: true, deletedAt: null },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ]);
    if (!isLeadStageCode(lead.currentStage.leadStageCode)) {
      conflict("PIPELINE_CONFIGURATION_INVALID", "A etapa atual não possui código operacional de pré-vendas.");
    }
    const hasNextAction = lead.tasks.length > 0;
    const pactoReady = lead.pactoRevisions[0]?.isQualificationReady ?? false;
    return Object.freeze({
      leadId: lead.id,
      currentStageId: lead.currentStage.id,
      currentStageCode: lead.currentStage.leadStageCode,
      currentStageName: lead.currentStage.name,
      stageEnteredAt: (lead.stageHistory[0]?.enteredAt ?? lead.createdAt).toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      hasNextAction,
      pactoReady,
      ...permission,
      disqualificationReasons: reasons,
      transitions: transitionOptions(pipeline.stages, lead.currentStage.leadStageCode),
    });
  }

  async function getScreen(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<PreSalesPipelineScreen> {
    const parsed = screenQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    if (parsed.data.responsible) {
      const [kind, id, extra] = parsed.data.responsible.split(":");
      if (extra || (kind !== "member" && kind !== "queue") || !z.string().uuid().safeParse(id).success) {
        invalidInput("Responsável inválido.");
      }
    }
    const [scope, pipeline] = await Promise.all([
      resolveLeadVisibilityScope(
        options.database,
        options.authorization,
        context,
        PermissionKeys.LEADS_READ,
      ),
      getPipeline(context.workspaceId, parsed.data.pipelineId),
    ]);
    const visibility = leadVisibilityWhere(context, scope);
    const responsibleFilter: Prisma.LeadWhereInput = parsed.data.responsible.startsWith("member:")
      ? { ownerMemberId: parsed.data.responsible.slice(7) }
      : parsed.data.responsible.startsWith("queue:")
        ? { queueId: parsed.data.responsible.slice(6) }
        : {};
    const searchFilter: Prisma.LeadWhereInput = parsed.data.q
      ? {
          OR: [
            { fullName: { contains: parsed.data.q, mode: "insensitive" } },
            { jobTitle: { contains: parsed.data.q, mode: "insensitive" } },
            { organizationName: { contains: parsed.data.q, mode: "insensitive" } },
          ],
        }
      : {};
    const priorityFilter: Prisma.LeadWhereInput = parsed.data.priority === "ALL"
      ? {}
      : { currentScore: { leadScore: { priorityBandCode: parsed.data.priority } } };
    const baseWhere: Prisma.LeadWhereInput = {
      workspaceId: context.workspaceId,
      pipelineId: pipeline.id,
      deletedAt: null,
      AND: [visibility, responsibleFilter, searchFilter, priorityFilter],
    };
    const cardLimitPerStage = 12;
    const pipelineResource: ResourceScope = {
      workspaceId: context.workspaceId,
      resourceType: "LeadPipeline",
      memberId: context.memberId,
    };
    const now = options.now();
    const historySince = new Date(now.getTime() - conversionPeriodDays * 86_400_000);
    const [workspace, groupedCounts, write, correct, ownerRefs, queueRefs, stageRows, healthRows, transitionRows] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
      options.database.lead.groupBy({ by: ["currentStageId"], where: baseWhere, _count: { _all: true } }),
      options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, pipelineResource),
      options.authorization.authorize(context, PermissionKeys.LEADS_ASSIGN, pipelineResource),
      options.database.lead.findMany({ where: { ...baseWhere, ownerMemberId: { not: null } }, distinct: ["ownerMemberId"], select: { ownerMemberId: true } }),
      options.database.lead.findMany({ where: { ...baseWhere, queueId: { not: null } }, distinct: ["queueId"], select: { queueId: true } }),
      Promise.all(pipeline.stages.map(async (stage) => {
        if (!isLeadStageCode(stage.leadStageCode)) return [];
        if (parsed.data.stageCode !== "ALL" && parsed.data.stageCode !== stage.leadStageCode) return [];
        return options.database.lead.findMany({
          where: { ...baseWhere, currentStageId: stage.id },
          orderBy: [{ nextActionAt: "asc" }, { lastActivityAt: "asc" }, { id: "asc" }],
          take: cardLimitPerStage,
          include: pipelineCardInclude,
        });
      })),
      options.database.lead.findMany({
        where: baseWhere,
        select: {
          id: true,
          currentStageId: true,
          createdAt: true,
          lastActivityAt: true,
          stageHistory: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true } },
          tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 1, select: { dueAt: true } },
        },
      }),
      options.database.stageHistory.findMany({
        where: { workspaceId: context.workspaceId, pipelineId: pipeline.id, leadId: { not: null }, enteredAt: { gte: historySince }, lead: baseWhere },
        orderBy: [{ leadId: "asc" }, { enteredAt: "asc" }, { id: "asc" }],
        select: { leadId: true, stageId: true, enteredAt: true, exitedAt: true },
      }),
    ]);
    const [members, queues] = await Promise.all([
      options.database.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId, id: { in: ownerRefs.flatMap((item) => item.ownerMemberId ? [item.ownerMemberId] : []) }, deletedAt: null },
        orderBy: { user: { displayName: "asc" } },
        select: { id: true, user: { select: { displayName: true } } },
      }),
      options.database.queue.findMany({
        where: { workspaceId: context.workspaceId, id: { in: queueRefs.flatMap((item) => item.queueId ? [item.queueId] : []) }, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    const counts = new Map(groupedCounts.map((item) => [item.currentStageId, item._count._all]));
    const rowsByStage = new Map(pipeline.stages.map((stage, index) => [stage.id, stageRows[index] ?? []]));
    const columns = pipeline.stages.flatMap((stage) => {
      if (!isLeadStageCode(stage.leadStageCode)) return [];
      const stageCode = stage.leadStageCode;
      const rows = rowsByStage.get(stage.id) ?? [];
      const leads: LeadPipelineCard[] = rows.map((lead) => toPipelineCard(lead, stage.name));
      const stageHealthRows = healthRows.filter((lead) => lead.currentStageId === stage.id);
      const expectedLimit = expectedStageHours[stageCode] ?? null;
      const today = workspaceDayRange(workspaceDateAt(now, workspace.timeZone), workspace.timeZone);
      const durations = stageHealthRows.map((lead) => Math.max(0, now.getTime() - (lead.stageHistory[0]?.enteredAt ?? lead.createdAt).getTime()) / 3_600_000);
      const stageIndex = pipeline.stages.findIndex((candidate) => candidate.id === stage.id);
      const nextStageId = pipeline.stages[stageIndex + 1]?.id ?? null;
      const exits = transitionRows.filter((row) => row.stageId === stage.id && row.exitedAt !== null);
      const nextByEntry = new Map(transitionRows.map((row, index) => [`${row.leadId}:${row.enteredAt.toISOString()}`, transitionRows[index + 1] ?? null]));
      const converted = exits.filter((row) => {
        const next = nextByEntry.get(`${row.leadId}:${row.enteredAt.toISOString()}`);
        return Boolean(nextStageId && next?.leadId === row.leadId && next.stageId === nextStageId);
      }).length;
      return [{
        id: stage.id,
        code: stageCode,
        name: stage.name,
        position: stage.position,
        count: counts.get(stage.id) ?? 0,
        displayedCount: leads.length,
        health: {
          stalled: stageHealthRows.filter((lead) => Math.max(lead.lastActivityAt.getTime(), (lead.stageHistory[0]?.enteredAt ?? lead.createdAt).getTime()) < now.getTime() - staleHours * 3_600_000).length,
          averageHoursInStage: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
          conversionToNextPercent: exits.length ? Math.round((converted / exits.length) * 1_000) / 10 : null,
          withoutTask: stageHealthRows.filter((lead) => lead.tasks.length === 0).length,
          withoutRecentContact: stageHealthRows.filter((lead) => lead.lastActivityAt.getTime() < now.getTime() - staleHours * 3_600_000).length,
          aboveExpectedLimit: expectedLimit === null ? 0 : durations.filter((hours) => hours > expectedLimit).length,
          actionDueToday: stageHealthRows.filter((lead) => lead.tasks[0] && lead.tasks[0].dueAt >= today.start && lead.tasks[0].dueAt < today.end).length,
          expectedLimitHours: expectedLimit,
          conversionPeriodDays,
        },
        leads,
      }];
    });
    return Object.freeze({
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      cardLimitPerStage,
      filters: parsed.data,
      responsibleOptions: [
        ...members.map((member) => ({ value: `member:${member.id}`, label: member.user.displayName })),
        ...queues.map((queue) => ({ value: `queue:${queue.id}`, label: queue.name })),
      ],
      stages: columns,
      canWrite: write.allowed,
      canCorrect: correct.allowed,
    });
  }

  async function getStagePage(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<LeadPipelineStagePage> {
    const parsed = stagePageSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    if (parsed.data.responsible) {
      const [kind, id, extra] = parsed.data.responsible.split(":");
      if (extra || (kind !== "member" && kind !== "queue") || !z.string().uuid().safeParse(id).success) invalidInput("Responsável inválido.");
    }
    const [scope, pipeline] = await Promise.all([
      resolveLeadVisibilityScope(options.database, options.authorization, context, PermissionKeys.LEADS_READ),
      getPipeline(context.workspaceId, parsed.data.pipelineId),
    ]);
    const stage = pipeline.stages.find((item) => item.id === parsed.data.stageId && isLeadStageCode(item.leadStageCode));
    if (!stage) notFound("Etapa do pipeline não encontrada.");
    const responsibleFilter: Prisma.LeadWhereInput = parsed.data.responsible.startsWith("member:")
      ? { ownerMemberId: parsed.data.responsible.slice(7) }
      : parsed.data.responsible.startsWith("queue:")
        ? { queueId: parsed.data.responsible.slice(6) }
        : {};
    const searchFilter: Prisma.LeadWhereInput = parsed.data.q ? { OR: [
      { fullName: { contains: parsed.data.q, mode: "insensitive" } },
      { jobTitle: { contains: parsed.data.q, mode: "insensitive" } },
      { organizationName: { contains: parsed.data.q, mode: "insensitive" } },
    ] } : {};
    const priorityFilter: Prisma.LeadWhereInput = parsed.data.priority === "ALL" ? {} : { currentScore: { leadScore: { priorityBandCode: parsed.data.priority } } };
    const where: Prisma.LeadWhereInput = {
      workspaceId: context.workspaceId,
      pipelineId: pipeline.id,
      currentStageId: stage.id,
      deletedAt: null,
      AND: [leadVisibilityWhere(context, scope), responsibleFilter, searchFilter, priorityFilter],
    };
    const [total, rows] = await Promise.all([
      options.database.lead.count({ where }),
      options.database.lead.findMany({
        where,
        orderBy: [{ nextActionAt: "asc" }, { lastActivityAt: "asc" }, { id: "asc" }],
        skip: parsed.data.offset,
        take: parsed.data.limit,
        include: pipelineCardInclude,
      }),
    ]);
    return Object.freeze({
      stageId: stage.id,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
      total,
      hasMore: parsed.data.offset + rows.length < total,
      leads: rows.map((lead) => toPipelineCard(lead, stage.name)),
    });
  }

  async function transition(context: AuthenticatedContext, payload: unknown) {
    const parsed = transitionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const leadForAuth = await getLeadForAuthorization(context.workspaceId, parsed.data.leadId);
    const resource = resourceForLead(context.workspaceId, leadForAuth);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, resource);
    if (parsed.data.managerCorrection) {
      await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_ASSIGN, resource);
    }

    const result = await options.database.$transaction(async (transaction) => {
      const result = await transitionLeadStageInTransaction(
        transaction,
        context,
        {
          leadId: parsed.data.leadId,
          targetStageId: parsed.data.targetStageId,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          reason: parsed.data.reason,
          origin: parsed.data.origin,
          managerCorrection: parsed.data.managerCorrection,
          confirmed: parsed.data.confirmed,
          ...(parsed.data.disqualificationReasonId !== undefined
            ? { disqualificationReasonId: parsed.data.disqualificationReasonId }
            : {}),
        },
        options.now(),
      );
      await options.beforeCommit?.();
      return result;
    });
    if (result.toStageCode === "QUALIFIED" && options.automationPublisher) {
      try {
        await options.database.$transaction((transaction) =>
          publishLeadQualifiedInTransaction(transaction, options.automationPublisher!, {
            workspaceId: context.workspaceId,
            leadId: result.leadId,
            occurredAt: new Date(result.occurredAt),
            actorId: context.actorId,
          }),
        );
      } catch {
        // A automação é opcional e nunca desfaz uma movimentação concluída.
      }
    }
    return result;
  }

  return Object.freeze({ getScreen, getStagePage, getLeadState, transition });
}

let service: ReturnType<typeof createPreSalesPipelineService> | undefined;

export function getPreSalesPipelineService() {
  service ??= createPreSalesPipelineService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
    automationPublisher: getAutomationEngineService(),
  });
  return service;
}
