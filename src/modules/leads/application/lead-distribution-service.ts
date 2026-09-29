import type { LeadAssignmentType, PrismaClient } from "@/generated/prisma/client";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { reassignLeadInTransaction } from "@/modules/leads/application/lead-assignment-operation";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

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

type LeadDistributionServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

export type ReceivingPauseResult = Readonly<{
  memberId: string;
  paused: boolean;
}>;

export type AssignmentResult = Readonly<{
  assignmentId: string;
  leadId: string;
  ownerMemberId: string | null;
  queueId: string | null;
}>;

export type HumanAttemptResult = Readonly<{
  leadId: string;
  occurredAt: Date;
  firstHumanAttemptRecorded: boolean;
  firstConnectedRecorded: boolean;
}>;

export type LeadDistributionService = Readonly<{
  assignManually: (
    context: AuthenticatedContext,
    payload: unknown,
  ) => Promise<AssignmentResult>;
  redistribute: (
    context: AuthenticatedContext,
    payload: unknown,
  ) => Promise<AssignmentResult>;
  setReceivingPause: (
    context: AuthenticatedContext,
    payload: unknown,
  ) => Promise<ReceivingPauseResult>;
  recordHumanAttempt: (
    context: AuthenticatedContext,
    payload: unknown,
  ) => Promise<HumanAttemptResult>;
}>;

const pauseInputSchema = z
  .object({
    memberId: z.string().uuid(),
    paused: z.boolean(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.paused && !input.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Informe o motivo da pausa.",
      });
    }
  });

const assignmentInputSchema = z
  .object({
    leadId: z.string().uuid(),
    memberId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const redistributionInputSchema = z
  .object({
    leadId: z.string().uuid(),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("MEMBER"), memberId: z.string().uuid() }),
      z.object({ type: z.literal("GENERAL_QUEUE") }),
    ]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const humanAttemptInputSchema = z
  .object({
    leadId: z.string().uuid(),
    outcome: z.enum(["CONNECTED", "NOT_CONNECTED"]),
    occurredAt: z.date().optional(),
    nextTask: z
      .object({
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(2_000).optional(),
        kind: z
          .enum([
            "GENERAL",
            "IMMEDIATE_CALL",
            "CALL",
            "MESSAGE",
            "EMAIL",
            "MEETING",
            "FOLLOW_UP",
          ])
          .default("FOLLOW_UP"),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "URGENT"])
          .default("MEDIUM"),
        dueAt: z.date(),
      })
      .strict()
      .optional(),
  })
  .strict();

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

export function createLeadDistributionService(
  options: LeadDistributionServiceOptions,
): LeadDistributionService {
  async function getLeadForAuthorization(
    context: AuthenticatedContext,
    leadId: string,
  ) {
    const lead = await options.database.lead.findFirst({
      where: {
        id: leadId,
        workspaceId: context.workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerMemberId: true,
        queueId: true,
        routingQueueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    return lead;
  }

  async function setReceivingPause(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<ReceivingPauseResult> {
    const parsed = pauseInputSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);

    const target = await options.database.workspaceMember.findFirst({
      where: {
        id: parsed.data.memberId,
        workspaceId: context.workspaceId,
        deletedAt: null,
        teamMemberships: {
          some: { function: "SDR", deletedAt: null, team: { deletedAt: null } },
        },
      },
      select: {
        id: true,
        leadReceivingPausedAt: true,
        teamMemberships: {
          where: { function: "SDR", deletedAt: null },
          take: 1,
          select: { teamId: true },
        },
      },
    });
    if (!target) notFound("SDR não encontrado.");

    await options.authorization.assertAuthorized(
      context,
      target.id === context.memberId
        ? PermissionKeys.LEADS_WRITE
        : PermissionKeys.LEADS_ASSIGN,
      {
        workspaceId: context.workspaceId,
        resourceType: "WorkspaceMember",
        resourceId: target.id,
        memberId: target.id,
        teamId: target.teamMemberships[0]?.teamId ?? null,
      },
    );

    const changedAt = options.now();
    return options.database.$transaction(async (transaction) => {
      const member = await transaction.workspaceMember.update({
        where: { id: target.id },
        data: parsed.data.paused
          ? {
              leadReceivingPausedAt: changedAt,
              leadReceivingPauseReason: parsed.data.reason!,
              leadReceivingPausedByActorId: context.actorId,
              updatedByActorId: context.actorId,
            }
          : {
              leadReceivingPausedAt: null,
              leadReceivingPauseReason: null,
              leadReceivingPausedByActorId: null,
              updatedByActorId: context.actorId,
            },
        select: { id: true, leadReceivingPausedAt: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: parsed.data.paused
            ? "lead.receiving.paused"
            : "lead.receiving.resumed",
          entityType: "WorkspaceMember",
          entityId: target.id,
          occurredAt: changedAt,
          changes: {
            previousPausedAt: target.leadReceivingPausedAt,
            pausedAt: member.leadReceivingPausedAt,
            reason: parsed.data.paused ? parsed.data.reason : null,
          },
        },
      });
      return Object.freeze({
        memberId: member.id,
        paused: member.leadReceivingPausedAt !== null,
      });
    });
  }

  async function changeAssignment(
    context: AuthenticatedContext,
    input: Readonly<{
      leadId: string;
      targetMemberId: string | null;
      reason: string;
      type: LeadAssignmentType;
      requireGeneralQueueOrigin: boolean;
    }>,
  ): Promise<AssignmentResult> {
    const authorizedLead = await getLeadForAuthorization(context, input.leadId);
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_ASSIGN,
      {
        workspaceId: context.workspaceId,
        resourceType: "Lead",
        resourceId: authorizedLead.id,
        ownerMemberId: authorizedLead.ownerMemberId,
        queueId: authorizedLead.queueId,
        teamId:
          authorizedLead.routingQueue?.teamId ??
          authorizedLead.queue?.teamId ??
          null,
      },
    );

    const assignedAt = options.now();
    return options.database.$transaction((transaction) =>
      reassignLeadInTransaction(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        leadId: input.leadId,
        targetMemberId: input.targetMemberId,
        reason: input.reason,
        type: input.type,
        requireGeneralQueueOrigin: input.requireGeneralQueueOrigin,
        assignedAt,
      }),
    );
  }

  async function assignManually(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<AssignmentResult> {
    const parsed = assignmentInputSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    return changeAssignment(context, {
      leadId: parsed.data.leadId,
      targetMemberId: parsed.data.memberId,
      reason: parsed.data.reason,
      type: "MANUAL",
      requireGeneralQueueOrigin: true,
    });
  }

  async function redistribute(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<AssignmentResult> {
    const parsed = redistributionInputSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    return changeAssignment(context, {
      leadId: parsed.data.leadId,
      targetMemberId:
        parsed.data.target.type === "MEMBER"
          ? parsed.data.target.memberId
          : null,
      reason: parsed.data.reason,
      type: "REDISTRIBUTION",
      requireGeneralQueueOrigin: false,
    });
  }

  async function recordHumanAttempt(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<HumanAttemptResult> {
    const parsed = humanAttemptInputSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const occurredAt = parsed.data.occurredAt ?? options.now();
    const history = createOperationalHistoryService({
      database: options.database,
      authorization: options.authorization,
      now: options.now,
    });
    const result = await history.recordActivity(context, {
      leadId: parsed.data.leadId,
      type:
        parsed.data.outcome === "CONNECTED"
          ? "CALL_CONNECTED"
          : "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject:
        parsed.data.outcome === "CONNECTED"
          ? "Contato conectado"
          : "Tentativa de contato",
      occurredAt,
      ...(parsed.data.nextTask ? { nextTask: parsed.data.nextTask } : {}),
    });
    return Object.freeze({
      leadId: result.leadId,
      occurredAt,
      firstHumanAttemptRecorded: result.firstHumanAttemptRecorded,
      firstConnectedRecorded: result.firstConnectedRecorded,
    });
  }

  return Object.freeze({
    assignManually,
    redistribute,
    setReceivingPause,
    recordHumanAttempt,
  });
}

let leadDistributionService:
  | LeadDistributionService
  | undefined;

export function getLeadDistributionService(): LeadDistributionService {
  leadDistributionService ??= createLeadDistributionService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return leadDistributionService;
}
