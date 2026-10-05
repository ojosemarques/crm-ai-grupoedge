import type {
  MeetingHistoryAction,
  MeetingStatus,
  PermissionScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import {
  cancelMeetingRemindersInTransaction,
  publishMeetingNoShowInTransaction,
  scheduleMeetingRemindersInTransaction,
  type TransactionalAutomationPublisher,
} from "@/modules/automations/application/lifecycle-automation-scheduler";
import {
  leadVisibilityWhere,
  resolveLeadVisibilityScope,
} from "@/modules/leads/application/lead-list-service";
import type {
  AgendaScreen,
  CloserOption,
  LeadMeetingsScreen,
  MeetingBriefing,
  MeetingHistoryItem,
  MeetingListItem,
} from "@/modules/meetings/domain/meeting-contracts";
import { recordOpportunityMeetingHeldInTransaction } from "@/modules/opportunities/application/opportunity-service";
import {
  transitionLeadStageInTransaction,
} from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { pactoDimensionLabels } from "@/modules/qualification/domain/pacto-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
  workspaceDayRange,
  workspaceWeekRange,
} from "@/shared/core/time/workspace-time";
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

type MeetingServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  automationPublisher?: TransactionalAutomationPublisher;
  beforeCommit?: () => Promise<void>;
}>;

const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const nextActionSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueAtLocal: localDateTimeSchema,
}).strict();

const agendaQuerySchema = z.object({
  view: z.enum(["day", "week"]).default("day"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closerId: z.string().uuid().optional().default(""),
}).strict();

const leadMeetingsQuerySchema = z.object({ leadId: z.string().uuid() }).strict();
const meetingQuerySchema = z.object({ meetingId: z.string().uuid() }).strict();

const scheduleSchema = z.object({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  closerId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  startsAtLocal: localDateTimeSchema,
  durationMinutes: z.union([z.literal(30), z.literal(40)]),
  observation: z.string().trim().max(5_000).nullable().optional(),
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CONFIRM"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  }).strict(),
  z.object({
    action: z.literal("RESCHEDULE"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    startsAtLocal: localDateTimeSchema,
    durationMinutes: z.union([z.literal(30), z.literal(40)]),
    reason: z.string().trim().min(3).max(2_000),
  }).strict(),
  z.object({
    action: z.literal("CANCEL"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2_000),
    nextAction: nextActionSchema,
  }).strict(),
  z.object({
    action: z.literal("ATTENDED"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    outcome: z.string().trim().min(3).max(5_000),
    nextAction: nextActionSchema,
  }).strict(),
  z.object({
    action: z.literal("NO_SHOW"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2_000),
    nextAction: nextActionSchema,
  }).strict(),
]);

const transcriptSchema = z.object({
  meetingId: z.string().uuid(),
  transcriptText: z.string().trim().min(20).max(100_000).nullable().optional(),
  summary: z.string().trim().min(10).max(10_000).nullable().optional(),
  policyVersion: z.literal("meeting-transcript-policy/v1"),
  consentConfirmed: z.literal(true),
  consentEvidence: z.string().trim().min(10).max(2_000),
  consentRecordedAt: z.string().datetime({ offset: true }),
  retentionUntil: z.string().datetime({ offset: true }),
}).strict().refine((value) => Boolean(value.transcriptText || value.summary), { message: "Informe transcrição ou resumo." });

type MeetingRow = Prisma.MeetingGetPayload<{
  include: {
    lead: { select: { fullName: true } };
    owner: { select: { user: { select: { displayName: true } } } };
    calendarLinks: { select: { syncState: true }; take: 1 };
  };
}>;

type MeetingAuthRow = Readonly<{
  id: string;
  leadId: string;
  ownerMemberId: string;
  status: MeetingStatus;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  revision: number;
  lead: Readonly<{
    ownerMemberId: string | null;
    queueId: string | null;
    routingQueue: { teamId: string | null } | null;
    queue: { teamId: string | null } | null;
  }>;
}>;

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

function leadResource(
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
    resourceType: "MeetingLead",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

function meetingResource(workspaceId: string, meeting: Pick<MeetingAuthRow, "id" | "ownerMemberId">): ResourceScope {
  return {
    workspaceId,
    resourceType: "Meeting",
    resourceId: meeting.id,
    ownerMemberId: meeting.ownerMemberId,
  };
}

async function lockCloser(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  memberId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`meeting-owner:${workspaceId}:${memberId}`}, 0))
  `;
}

async function assertNoConflict(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    ownerMemberId: string;
    startsAt: Date;
    endsAt: Date;
    excludeMeetingId?: string;
  }>,
) {
  const overlapping = await transaction.meeting.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ownerMemberId: input.ownerMemberId,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      deletedAt: null,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeMeetingId ? { id: { not: input.excludeMeetingId } } : {}),
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (overlapping) {
    conflict(
      "MEETING_TIME_CONFLICT",
      `O closer já possui uma reunião entre ${overlapping.startsAt.toISOString()} e ${overlapping.endsAt.toISOString()}.`,
    );
  }
}

async function findNextTask(transaction: Prisma.TransactionClient, workspaceId: string, leadId: string) {
  return transaction.task.findFirst({
    where: { workspaceId, leadId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
}

function taskProjection(task: Awaited<ReturnType<typeof findNextTask>>) {
  return task
    ? { nextActionTaskId: task.id, nextActionAt: task.dueAt, nextActionDescription: task.title }
    : { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null };
}

function serializeMeeting(row: MeetingRow, now: Date, canWrite: boolean): MeetingListItem {
  return Object.freeze({
    id: row.id,
    leadId: row.leadId,
    opportunityId: row.opportunityId,
    leadName: row.lead.fullName,
    ownerMemberId: row.ownerMemberId,
    closerName: row.owner.user.displayName,
    title: row.title,
    status: row.status,
    operationalStatus:
      (row.status === "SCHEDULED" || row.status === "CONFIRMED") && row.startsAt < now
        ? "PENDING_STATUS"
        : row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    durationMinutes: row.durationMinutes as 30 | 40,
    timeZone: row.timeZone,
    observation: row.observation,
    outcome: row.outcome,
    revision: row.revision,
    canWrite,
    calendarSync: {
      state: (row.calendarLinks[0]?.syncState ?? "NOT_LINKED") as MeetingListItem["calendarSync"]["state"],
      externalEgress: false as const,
    },
  });
}

function statusLabel(status: MeetingStatus): string {
  return ({
    SCHEDULED: "agendada",
    CONFIRMED: "confirmada",
    COMPLETED: "realizada",
    CANCELLED: "cancelada",
    NO_SHOW: "não compareceu",
  } satisfies Record<MeetingStatus, string>)[status];
}

function historyAction(input: z.output<typeof actionSchema>): MeetingHistoryAction {
  return ({
    CONFIRM: "CONFIRMED",
    RESCHEDULE: "RESCHEDULED",
    CANCEL: "CANCELLED",
    ATTENDED: "ATTENDED",
    NO_SHOW: "NO_SHOW",
  } as const)[input.action];
}

export function createMeetingService(options: MeetingServiceOptions) {
  async function workspace(context: AuthenticatedContext) {
    return options.database.workspace.findFirstOrThrow({
      where: { id: context.workspaceId, status: "ACTIVE", deletedAt: null },
      select: { id: true, timeZone: true, defaultMeetingDurationMinutes: true },
    });
  }

  async function getMeetingForAuthorization(meetingId: string, workspaceId: string): Promise<MeetingAuthRow> {
    const meeting = await options.database.meeting.findFirst({
      where: { id: meetingId, workspaceId, deletedAt: null },
      select: {
        id: true,
        leadId: true,
        ownerMemberId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timeZone: true,
        revision: true,
        lead: {
          select: {
            ownerMemberId: true,
            queueId: true,
            routingQueue: { select: { teamId: true } },
            queue: { select: { teamId: true } },
          },
        },
      },
    });
    if (!meeting) notFound("Reunião não encontrada.");
    return meeting;
  }

  async function authorizeMeetingOrLead(
    context: AuthenticatedContext,
    permission: PermissionKey,
    meeting: MeetingAuthRow,
  ) {
    const [meetingDecision, leadDecision] = await Promise.all([
      options.authorization.authorize(context, permission, meetingResource(context.workspaceId, meeting)),
      options.authorization.authorize(
        context,
        permission,
        leadResource(context.workspaceId, { id: meeting.leadId, ...meeting.lead }),
      ),
    ]);
    if (meetingDecision.allowed || leadDecision.allowed) return;
    await options.authorization.assertAuthorized(context, permission, meetingResource(context.workspaceId, meeting));
  }

  async function teamIds(context: AuthenticatedContext) {
    const rows = await options.database.teamMember.findMany({
      where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null },
      select: { teamId: true },
    });
    return rows.map((row) => row.teamId);
  }

  async function closerOptions(context: AuthenticatedContext, scope: PermissionScope): Promise<CloserOption[]> {
    const teams = scope === "TEAM" ? await teamIds(context) : [];
    const rows = await options.database.workspaceMember.findMany({
      where: {
        ...commercialMemberWhere({
          workspaceId: context.workspaceId,
          functions: ["CLOSER"],
          ...(scope === "OWN" ? { memberId: context.memberId } : {}),
          ...(scope === "TEAM" ? { teamIds: teams } : {}),
        }),
      },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      select: { id: true, user: { select: { displayName: true } } },
    });
    return rows.map((row) => ({ id: row.id, name: row.user.displayName }));
  }

  async function leadOptions(context: AuthenticatedContext) {
    const permission = await options.authorization.authorize(context, PermissionKeys.LEADS_READ, {
      workspaceId: context.workspaceId,
      resourceType: "MeetingLeadOptions",
      memberId: context.memberId,
    });
    if (!permission.allowed) return [];
    const visibility = await resolveLeadVisibilityScope(
      options.database,
      options.authorization,
      context,
      PermissionKeys.LEADS_READ,
    );
    const rows = await options.database.lead.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        AND: [leadVisibilityWhere(context, visibility)],
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: 200,
      select: { id: true, fullName: true, opportunities: { where: { status: "OPEN", deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, name: true } } },
    });
    return rows.map((row) => ({ id: row.id, name: row.fullName, opportunities: row.opportunities }));
  }

  async function getAgenda(context: AuthenticatedContext, payload: unknown): Promise<AgendaScreen> {
    const parsed = agendaQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const workspaceRow = await workspace(context);
    const readDecision = await options.authorization.authorize(context, PermissionKeys.MEETINGS_READ, {
      workspaceId: context.workspaceId,
      resourceType: "MeetingAgenda",
      memberId: context.memberId,
    });
    if (!readDecision.allowed) {
      await options.authorization.assertAuthorized(context, PermissionKeys.MEETINGS_READ, {
        workspaceId: context.workspaceId,
        resourceType: "MeetingAgenda",
        memberId: context.memberId,
      });
      throw new Error("unreachable");
    }
    const selectedDate = parsed.data.date ?? workspaceDateAt(options.now(), workspaceRow.timeZone);
    const range = parsed.data.view === "week"
      ? workspaceWeekRange(selectedDate, workspaceRow.timeZone)
      : {
          ...workspaceDayRange(selectedDate, workspaceRow.timeZone),
          startDate: selectedDate,
          endDate: selectedDate,
        };
    const [closers, writeDecision, leads] = await Promise.all([
      closerOptions(context, readDecision.scope),
      options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, {
        workspaceId: context.workspaceId,
        resourceType: "MeetingAgenda",
        memberId: context.memberId,
      }),
      leadOptions(context),
    ]);
    const allowedCloserIds = new Set(closers.map((closer) => closer.id));
    if (parsed.data.closerId && !allowedCloserIds.has(parsed.data.closerId)) {
      await options.authorization.assertAuthorized(context, PermissionKeys.MEETINGS_READ, {
        workspaceId: context.workspaceId,
        resourceType: "MeetingAgendaCloser",
        ownerMemberId: parsed.data.closerId,
      });
    }
    const ownerFilter = parsed.data.closerId
      ? { ownerMemberId: parsed.data.closerId }
      : readDecision.scope === "OWN"
        ? { ownerMemberId: context.memberId }
        : readDecision.scope === "TEAM"
          ? { ownerMemberId: { in: [...allowedCloserIds] } }
          : {};
    const rows = await options.database.meeting.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        startsAt: { gte: range.start, lt: range.end },
        ...ownerFilter,
      },
      include: {
        lead: { select: { fullName: true } },
        owner: { select: { user: { select: { displayName: true } } } },
        calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    const permissions = await Promise.all(rows.map((row) =>
      options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, meetingResource(context.workspaceId, row)),
    ));
    const canSchedule = writeDecision.allowed && leads.length > 0 && closers.length > 0;
    if (workspaceRow.defaultMeetingDurationMinutes !== 30 && workspaceRow.defaultMeetingDurationMinutes !== 40) {
      conflict("SETTINGS_INVALID", "A duração padrão de reunião é inválida.");
    }
    return Object.freeze({
      generatedAt: options.now().toISOString(),
      timeZone: workspaceRow.timeZone,
      defaultDurationMinutes: workspaceRow.defaultMeetingDurationMinutes,
      view: parsed.data.view,
      selectedDate,
      rangeLabel: parsed.data.view === "week"
        ? `${range.startDate} a ${range.endDate}`
        : selectedDate,
      closerId: parsed.data.closerId,
      canSchedule,
      canFilterCloser: readDecision.scope !== "OWN",
      closerOptions: closers,
      leadOptions: leads,
      meetings: rows.map((row, index) => serializeMeeting(row, options.now(), permissions[index]?.allowed ?? false)),
    });
  }

  async function getLeadMeetings(context: AuthenticatedContext, payload: unknown): Promise<LeadMeetingsScreen> {
    const parsed = leadMeetingsQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
        opportunities: { where: { status: "OPEN", deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, name: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    await options.authorization.assertAuthorized(context, PermissionKeys.MEETINGS_READ, leadResource(context.workspaceId, lead));
    const [workspaceRow, write, rows] = await Promise.all([
      workspace(context),
      options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, leadResource(context.workspaceId, lead)),
      options.database.meeting.findMany({
        where: { workspaceId: context.workspaceId, leadId: lead.id, deletedAt: null },
        include: {
          lead: { select: { fullName: true } },
          owner: { select: { user: { select: { displayName: true } } } },
          calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
          history: {
            orderBy: [{ meetingRevision: "desc" }],
            include: { recordedBy: { select: { displayName: true } } },
          },
        },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const closers = write.allowed
      ? await closerOptions(context, "WORKSPACE")
      : [];
    if (workspaceRow.defaultMeetingDurationMinutes !== 30 && workspaceRow.defaultMeetingDurationMinutes !== 40) {
      conflict("SETTINGS_INVALID", "A duração padrão de reunião é inválida.");
    }
    return Object.freeze({
      leadId: lead.id,
      timeZone: workspaceRow.timeZone,
      defaultDurationMinutes: workspaceRow.defaultMeetingDurationMinutes,
      canSchedule:
        write.allowed &&
        closers.length > 0 &&
        !rows.some((meeting) => meeting.status === "SCHEDULED" || meeting.status === "CONFIRMED"),
      closerOptions: closers,
      opportunityOptions: lead.opportunities,
      meetings: rows.map((row) => ({
        ...serializeMeeting(row, options.now(), write.allowed),
        history: row.history.map((history): MeetingHistoryItem => ({
          id: history.id,
          action: history.action,
          previousStatus: history.previousStatus,
          newStatus: history.newStatus,
          previousStartsAt: history.previousStartsAt?.toISOString() ?? null,
          newStartsAt: history.newStartsAt.toISOString(),
          reason: history.reason,
          outcome: history.outcome,
          occurredAt: history.occurredAt.toISOString(),
          actorName: history.recordedBy.displayName,
        })),
      })),
    });
  }

  async function schedule(context: AuthenticatedContext, payload: unknown) {
    const parsed = scheduleSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const workspaceRow = await workspace(context);
    const startsAt = parseWorkspaceLocalDateTime(parsed.data.startsAtLocal, workspaceRow.timeZone);
    const endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60_000);
    if (startsAt <= options.now()) conflict("MEETING_IN_PAST", "A reunião deve ser agendada no futuro.");
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    await options.authorization.assertAuthorized(context, PermissionKeys.MEETINGS_WRITE, leadResource(context.workspaceId, lead));

    return options.database.$transaction(async (transaction) => {
      await lockCloser(transaction, context.workspaceId, parsed.data.closerId);
      const closer = await transaction.workspaceMember.findFirst({
        where: {
          id: parsed.data.closerId,
          ...commercialMemberWhere({
            workspaceId: context.workspaceId,
            functions: ["CLOSER"],
          }),
        },
        select: { id: true },
      });
      if (!closer) notFound("Closer não encontrado ou indisponível.");
      await assertNoConflict(transaction, {
        workspaceId: context.workspaceId,
        ownerMemberId: closer.id,
        startsAt,
        endsAt,
      });
      const currentLead = await transaction.lead.findFirst({
        where: { id: lead.id, workspaceId: context.workspaceId, deletedAt: null },
        select: {
          id: true,
          ownerMemberId: true,
          queueId: true,
          pipelineId: true,
          currentStage: { select: { leadStageCode: true } },
          meetings: {
            where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null },
            take: 1,
            select: { id: true },
          },
          opportunities: {
            where: { status: "OPEN", deletedAt: null },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: 2,
            select: { id: true },
          },
        },
      });
      if (!currentLead) notFound("Lead não encontrado.");
      if (currentLead.meetings.length > 0) {
        conflict("LEAD_ALREADY_HAS_ACTIVE_MEETING", "O lead já possui uma reunião ativa.");
      }
      const opportunityId = parsed.data.opportunityId === null
        ? null
        : parsed.data.opportunityId ?? (currentLead.opportunities.length === 1 ? currentLead.opportunities[0]!.id : null);
      if (parsed.data.opportunityId && !currentLead.opportunities.some((item) => item.id === parsed.data.opportunityId)) {
        conflict("MEETING_OPPORTUNITY_INVALID", "A oportunidade não está aberta ou não pertence ao lead.");
      }
      const occurredAt = options.now();
      const meeting = await transaction.meeting.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: currentLead.id,
          opportunityId,
          ownerMemberId: closer.id,
          title: parsed.data.title,
          status: "SCHEDULED",
          startsAt,
          endsAt,
          durationMinutes: parsed.data.durationMinutes,
          timeZone: workspaceRow.timeZone,
          observation: parsed.data.observation || null,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      const task = await transaction.task.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: currentLead.id,
          opportunityId,
          meetingId: meeting.id,
          assigneeMemberId: closer.id,
          title: `Reunião: ${parsed.data.title}`,
          description: parsed.data.observation || null,
          kind: "MEETING",
          status: "OPEN",
          priority: "HIGH",
          dueAt: startsAt,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      await transaction.meetingHistory.create({
        data: {
          workspaceId: context.workspaceId,
          meetingId: meeting.id,
          leadId: currentLead.id,
          ownerMemberId: closer.id,
          meetingRevision: 1,
          action: "SCHEDULED",
          newStatus: "SCHEDULED",
          newStartsAt: startsAt,
          newEndsAt: endsAt,
          occurredAt,
          recordedByActorId: context.actorId,
          createdAt: occurredAt,
        },
      });
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: currentLead.id,
          opportunityId,
          meetingId: meeting.id,
          type: "MEETING",
          direction: "INTERNAL",
          result: "SCHEDULED",
          subject: `Reunião agendada: ${parsed.data.title}`,
          description: parsed.data.observation || null,
          occurredAt,
          nextActionAt: startsAt,
          nextActionDescription: task.title,
          newValues: {
            meetingId: meeting.id,
            closerId: closer.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: parsed.data.durationMinutes,
            timeZone: workspaceRow.timeZone,
          },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "meeting.scheduled",
          entityType: "Meeting",
          entityId: meeting.id,
          occurredAt,
          changes: {
            leadId: currentLead.id,
            closerId: closer.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: parsed.data.durationMinutes,
            taskId: task.id,
            activityId: activity.id,
          },
          metadata: { timeZone: workspaceRow.timeZone },
        },
      });
      if (currentLead.currentStage.leadStageCode !== "MEETING_SCHEDULED") {
        const target = await transaction.pipelineStage.findFirst({
          where: {
            workspaceId: context.workspaceId,
            pipelineId: currentLead.pipelineId,
            leadStageCode: "MEETING_SCHEDULED",
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!target) conflict("PIPELINE_CONFIGURATION_INVALID", "A etapa Reunião agendada não está configurada.");
        await transitionLeadStageInTransaction(transaction, context, {
          leadId: currentLead.id,
          targetStageId: target.id,
          reason: `Reunião ${meeting.id} agendada para ${startsAt.toISOString()}.`,
          origin: "MEETING",
          managerCorrection: currentLead.currentStage.leadStageCode !== "QUALIFIED",
          confirmed: true,
        }, occurredAt);
      } else {
        const nextTask = await findNextTask(transaction, context.workspaceId, currentLead.id);
        await transaction.lead.update({
          where: { id: currentLead.id },
          data: {
            ...taskProjection(nextTask),
            lastActivityAt: occurredAt,
            updatedByActorId: context.actorId,
            updatedAt: occurredAt,
          },
        });
      }
      if (opportunityId) {
        await transaction.opportunity.update({ where: { id: opportunityId }, data: { nextActionTaskId: task.id, nextActionAt: startsAt, nextActionDescription: task.title, updatedByActorId: context.actorId, updatedAt: occurredAt } });
      }
      if (options.automationPublisher) {
        await scheduleMeetingRemindersInTransaction(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            leadId: currentLead.id,
            meetingId: meeting.id,
            meetingRevision: meeting.revision,
            startsAt,
            occurredAt,
            actorId: context.actorId,
          },
        );
      }
      await options.beforeCommit?.();
      return Object.freeze({ meetingId: meeting.id, taskId: task.id, revision: meeting.revision });
    });
  }

  async function act(context: AuthenticatedContext, payload: unknown) {
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const authorizedMeeting = await getMeetingForAuthorization(parsed.data.meetingId, context.workspaceId);
    await authorizeMeetingOrLead(context, PermissionKeys.MEETINGS_WRITE, authorizedMeeting);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await lockCloser(transaction, context.workspaceId, authorizedMeeting.ownerMemberId);
      const meeting = await transaction.meeting.findFirst({
        where: { id: parsed.data.meetingId, workspaceId: context.workspaceId, deletedAt: null },
        include: { lead: { select: { ownerMemberId: true, queueId: true } } },
      });
      if (!meeting) notFound("Reunião não encontrada.");
      if (meeting.revision !== parsed.data.expectedRevision) {
        conflict("MEETING_VERSION_CONFLICT", "A reunião mudou. Recarregue antes de continuar.");
      }
      if (meeting.status !== "SCHEDULED" && meeting.status !== "CONFIRMED") {
        conflict("MEETING_ALREADY_CLOSED", "A reunião já possui um resultado final.");
      }

      let newStatus: MeetingStatus = meeting.status;
      let startsAt = meeting.startsAt;
      let endsAt = meeting.endsAt;
      let reason: string | null = null;
      let outcome: string | null = null;
      if (parsed.data.action === "CONFIRM") {
        if (meeting.status === "CONFIRMED") conflict("MEETING_ALREADY_CONFIRMED", "A reunião já está confirmada.");
        newStatus = "CONFIRMED";
      } else if (parsed.data.action === "RESCHEDULE") {
        startsAt = parseWorkspaceLocalDateTime(parsed.data.startsAtLocal, meeting.timeZone);
        endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60_000);
        if (startsAt <= now) conflict("MEETING_IN_PAST", "A nova data deve estar no futuro.");
        await assertNoConflict(transaction, {
          workspaceId: context.workspaceId,
          ownerMemberId: meeting.ownerMemberId,
          startsAt,
          endsAt,
          excludeMeetingId: meeting.id,
        });
        newStatus = "SCHEDULED";
        reason = parsed.data.reason;
      } else if (parsed.data.action === "CANCEL") {
        newStatus = "CANCELLED";
        reason = parsed.data.reason;
      } else if (parsed.data.action === "ATTENDED") {
        if (meeting.startsAt > now) conflict("MEETING_NOT_STARTED", "Registre o comparecimento somente após o início da reunião.");
        newStatus = "COMPLETED";
        outcome = parsed.data.outcome;
      } else {
        if (meeting.startsAt > now) conflict("MEETING_NOT_STARTED", "Registre o no-show somente após o início da reunião.");
        newStatus = "NO_SHOW";
        reason = parsed.data.reason;
        outcome = parsed.data.reason;
      }

      const updated = await transaction.meeting.update({
        where: { id: meeting.id },
        data: {
          status: newStatus,
          startsAt,
          endsAt,
          durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
          outcome,
          confirmedAt: parsed.data.action === "CONFIRM" ? now : parsed.data.action === "RESCHEDULE" ? null : meeting.confirmedAt,
          cancelledAt: parsed.data.action === "CANCEL" ? now : null,
          completedAt: parsed.data.action === "ATTENDED" ? now : null,
          noShowAt: parsed.data.action === "NO_SHOW" ? now : null,
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: now,
        },
      });

      await transaction.meetingHistory.create({
        data: {
          workspaceId: context.workspaceId,
          meetingId: meeting.id,
          leadId: meeting.leadId,
          ownerMemberId: meeting.ownerMemberId,
          meetingRevision: updated.revision,
          action: historyAction(parsed.data),
          previousStatus: meeting.status,
          newStatus,
          previousStartsAt: meeting.startsAt,
          previousEndsAt: meeting.endsAt,
          newStartsAt: startsAt,
          newEndsAt: endsAt,
          reason,
          outcome,
          occurredAt: now,
          recordedByActorId: context.actorId,
          createdAt: now,
        },
      });

      if (parsed.data.action === "RESCHEDULE") {
        await transaction.task.updateMany({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
          data: { dueAt: startsAt, updatedByActorId: context.actorId, updatedAt: now },
        });
      }
      let recoveryTaskId: string | null = null;
      if (
        parsed.data.action === "CANCEL" ||
        parsed.data.action === "ATTENDED" ||
        parsed.data.action === "NO_SHOW"
      ) {
        await transaction.task.updateMany({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
          data: {
            status: parsed.data.action === "ATTENDED" ? "COMPLETED" : "CANCELLED",
            completedAt: parsed.data.action === "ATTENDED" ? now : null,
            result: outcome ?? reason,
            updatedByActorId: context.actorId,
            updatedAt: now,
          },
        });
        const nextAction = parsed.data.nextAction;
        const dueAt = parseWorkspaceLocalDateTime(nextAction.dueAtLocal, meeting.timeZone);
        if (dueAt <= now) invalidInput("A próxima ação deve estar no futuro.");
        const recoveryTask = await transaction.task.create({
          data: {
            workspaceId: context.workspaceId,
            leadId: meeting.leadId,
            opportunityId: meeting.opportunityId,
            assigneeMemberId: meeting.opportunityId
              ? meeting.ownerMemberId
              : meeting.lead.ownerMemberId ?? meeting.ownerMemberId,
            queueId: meeting.opportunityId || meeting.lead.ownerMemberId
              ? null
              : meeting.lead.queueId,
            title: nextAction.title,
            kind: "FOLLOW_UP",
            status: "OPEN",
            priority: parsed.data.action === "NO_SHOW" ? "HIGH" : "MEDIUM",
            dueAt,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        recoveryTaskId = recoveryTask.id;
      }
      const nextTask = await findNextTask(transaction, context.workspaceId, meeting.leadId);
      const opportunityTask = meeting.opportunityId
        ? await transaction.task.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: meeting.opportunityId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, title: true, dueAt: true } })
        : null;
      await transaction.lead.update({
        where: { id: meeting.leadId },
        data: {
          ...taskProjection(nextTask),
          lastActivityAt: now,
          updatedByActorId: context.actorId,
          updatedAt: now,
        },
      });
      if (meeting.opportunityId) {
        await transaction.opportunity.update({ where: { id: meeting.opportunityId }, data: { nextActionTaskId: opportunityTask?.id ?? null, nextActionAt: opportunityTask?.dueAt ?? null, nextActionDescription: opportunityTask?.title ?? null, updatedByActorId: context.actorId, updatedAt: now } });
      }
      const activityResult = ({
        CONFIRM: "INFORMATION",
        RESCHEDULE: "SCHEDULED",
        CANCEL: "CANCELLED",
        ATTENDED: "COMPLETED",
        NO_SHOW: "NO_SHOW",
      } as const)[parsed.data.action];
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: meeting.leadId,
          opportunityId: meeting.opportunityId,
          meetingId: meeting.id,
          type: "MEETING",
          direction: "INTERNAL",
          result: activityResult,
          subject: `Reunião ${statusLabel(newStatus)}: ${meeting.title}`,
          description: outcome ?? reason,
          occurredAt: now,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues: {
            status: meeting.status,
            startsAt: meeting.startsAt.toISOString(),
            endsAt: meeting.endsAt.toISOString(),
            revision: meeting.revision,
          },
          newValues: {
            status: newStatus,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            revision: updated.revision,
          },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: `meeting.${historyAction(parsed.data).toLowerCase()}`,
          entityType: "Meeting",
          entityId: meeting.id,
          occurredAt: now,
          changes: {
            fromStatus: meeting.status,
            toStatus: newStatus,
            previousStartsAt: meeting.startsAt.toISOString(),
            newStartsAt: startsAt.toISOString(),
            reason,
            outcome,
            activityId: activity.id,
          },
          metadata: { timeZone: meeting.timeZone, revision: updated.revision },
        },
      });
      if (parsed.data.action === "ATTENDED" && meeting.opportunityId) {
        await recordOpportunityMeetingHeldInTransaction(
          transaction,
          context,
          meeting.opportunityId,
          now,
        );
      }
      if (options.automationPublisher && parsed.data.action === "RESCHEDULE") {
        await scheduleMeetingRemindersInTransaction(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            leadId: meeting.leadId,
            meetingId: meeting.id,
            meetingRevision: updated.revision,
            startsAt,
            occurredAt: now,
            actorId: context.actorId,
          },
        );
      } else if (options.automationPublisher && parsed.data.action === "NO_SHOW") {
        await publishMeetingNoShowInTransaction(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            leadId: meeting.leadId,
            meetingId: meeting.id,
            meetingRevision: updated.revision,
            recoveryTaskId,
            occurredAt: now,
            actorId: context.actorId,
          },
        );
      } else if (
        options.automationPublisher &&
        (parsed.data.action === "CANCEL" || parsed.data.action === "ATTENDED")
      ) {
        await cancelMeetingRemindersInTransaction(transaction, {
          workspaceId: context.workspaceId,
          leadId: meeting.leadId,
          meetingId: meeting.id,
          occurredAt: now,
          actorId: context.actorId,
          reasonCode: "MEETING_CLOSED",
          reason: "Lembretes cancelados porque a reunião foi encerrada.",
        });
      }
      await options.beforeCommit?.();
      return Object.freeze({
        meetingId: meeting.id,
        status: updated.status,
        revision: updated.revision,
        startsAt: updated.startsAt.toISOString(),
      });
    });
  }

  async function getBriefing(context: AuthenticatedContext, payload: unknown): Promise<MeetingBriefing> {
    const parsed = meetingQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const authorized = await getMeetingForAuthorization(parsed.data.meetingId, context.workspaceId);
    await authorizeMeetingOrLead(context, PermissionKeys.MEETINGS_READ, authorized);
    const transcriptPermission = await options.authorization.authorize(context, PermissionKeys.MEETING_TRANSCRIPTS_READ, meetingResource(context.workspaceId, authorized));
    const transcriptManagePermission = await options.authorization.authorize(context, PermissionKeys.MEETING_TRANSCRIPTS_MANAGE, meetingResource(context.workspaceId, authorized));
    const row = await options.database.meeting.findFirst({
      where: { id: authorized.id, workspaceId: context.workspaceId, deletedAt: null },
      include: {
        owner: { select: { user: { select: { displayName: true } } } },
        opportunity: { select: { id: true, name: true, nextActionTaskId: true, nextActionAt: true, nextActionDescription: true } },
        calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
        lead: {
          include: {
            submissions: {
              orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                submittedInterestSummary: true,
                submittedJobTitle: true,
                submittedOrganizationName: true,
                submittedCity: true,
                submittedStateCode: true,
                submittedBudgetCents: true,
              },
            },
            pactoRevisions: {
              where: { kind: "VALIDATED" },
              orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
              take: 1,
              include: { dimensions: { orderBy: { dimension: "asc" } } },
            },
            activities: {
              orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
              take: 10,
              select: { subject: true, description: true, occurredAt: true },
            },
          },
        },
      },
    });
    if (!row) notFound("Reunião não encontrada.");
    const permission = await options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, meetingResource(context.workspaceId, row));
    const meeting = serializeMeeting(row, options.now(), permission.allowed);
    const transcriptMetadata = await options.database.meetingTranscriptArtifact.findFirst({ where: { workspaceId: context.workspaceId, meetingId: row.id }, orderBy: { version: "desc" }, select: { id: true, version: true, consentRecordedAt: true, retentionUntil: true } });
    const transcriptExpired = Boolean(transcriptMetadata && transcriptMetadata.retentionUntil <= options.now());
    const transcriptArtifact = transcriptMetadata && transcriptPermission.allowed && !transcriptExpired
      ? await options.database.meetingTranscriptArtifact.findUnique({ where: { id: transcriptMetadata.id }, select: { transcriptText: true, summary: true, policyVersion: true } })
      : null;
    if (transcriptMetadata && transcriptArtifact) {
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "meeting.transcript.read", entityType: "MeetingTranscriptArtifact", entityId: transcriptMetadata.id, occurredAt: options.now(), metadata: { meetingId: row.id, version: transcriptMetadata.version } } });
    }
    const submission = row.lead.submissions[0] ?? null;
    const revision = row.lead.pactoRevisions[0] ?? null;
    const dimensions = new Map(revision?.dimensions.map((dimension) => [dimension.dimension, dimension]) ?? []);
    const evidence = (dimension: "AFFLICTION" | "CAPACITY" | "DECISION" | "OPPORTUNITY_NOW") => {
      const item = dimensions.get(dimension);
      return item?.evidence ?? item?.note ?? null;
    };
    const unansweredQuestions = Object.entries(pactoDimensionLabels).flatMap(([dimension, label]) => {
      const item = dimensions.get(dimension as keyof typeof pactoDimensionLabels);
      return !item || item.status === "UNKNOWN" ? [`Investigar ${label}.`] : [];
    });
    const location = [submission?.submittedCity ?? row.lead.city, submission?.submittedStateCode ?? row.lead.stateCode]
      .filter(Boolean).join(" / ");
    return Object.freeze({
      meeting,
      summary: [
        `${row.lead.fullName}${row.lead.jobTitle ? ` atua como ${row.lead.jobTitle}` : ""}.`,
        row.lead.interestSummary ?? submission?.submittedInterestSummary ?? "Dor ou interesse ainda não registrado.",
        `${location ? `Localidade: ${location}. ` : ""}Reunião com ${row.owner.user.displayName}.`,
      ].join("\n"),
      formAnswers: {
        interestSummary: submission?.submittedInterestSummary ?? null,
        jobTitle: submission?.submittedJobTitle ?? null,
        organizationName: submission?.submittedOrganizationName ?? null,
        city: submission?.submittedCity ?? null,
        stateCode: submission?.submittedStateCode ?? null,
        budgetCents: submission?.submittedBudgetCents === null || submission?.submittedBudgetCents === undefined
          ? null
          : Number(submission.submittedBudgetCents),
      },
      pacto: Object.entries(pactoDimensionLabels).map(([dimension, label]) => {
        const item = dimensions.get(dimension as keyof typeof pactoDimensionLabels);
        return {
          dimension,
          label,
          status: item?.status ?? "UNKNOWN",
          evidence: item?.evidence ?? item?.note ?? null,
        };
      }),
      painInLeadWords: evidence("AFFLICTION") ?? submission?.submittedInterestSummary ?? row.lead.interestSummary,
      decisionMaker: evidence("DECISION"),
      capacity: evidence("CAPACITY") ?? (row.lead.budgetCents === null ? null : `Orçamento informado: ${Number(row.lead.budgetCents)} centavos.`),
      urgency: evidence("OPPORTUNITY_NOW"),
      unansweredQuestions,
      recentHistory: row.lead.activities.map((activity) => ({
        subject: activity.subject,
        description: activity.description,
        occurredAt: activity.occurredAt.toISOString(),
      })),
      recommendedNextAction: meeting.operationalStatus === "PENDING_STATUS"
        ? "Registrar comparecimento, no-show ou remarcação agora."
        : meeting.status === "SCHEDULED"
          ? "Confirmar a reunião e revisar as perguntas sem resposta."
          : meeting.status === "CONFIRMED"
            ? "Revisar o briefing antes do horário agendado."
            : "Executar a próxima ação persistida no lead.",
      businessContext: {
        opportunityId: row.opportunity?.id ?? null,
        opportunityName: row.opportunity?.name ?? null,
        nextAction: row.opportunity?.nextActionTaskId && row.opportunity.nextActionAt && row.opportunity.nextActionDescription
          ? { taskId: row.opportunity.nextActionTaskId, title: row.opportunity.nextActionDescription, dueAt: row.opportunity.nextActionAt.toISOString() }
          : null,
      },
      transcript: !transcriptMetadata
        ? { status: "ABSENT" as const, visible: false, canManage: transcriptManagePermission.allowed, version: null, transcriptText: null, summary: null, policyVersion: null, consentRecordedAt: null, retentionUntil: null }
        : transcriptExpired
          ? { status: "EXPIRED" as const, visible: false, canManage: transcriptManagePermission.allowed, version: transcriptMetadata.version, transcriptText: null, summary: null, policyVersion: null, consentRecordedAt: transcriptMetadata.consentRecordedAt.toISOString(), retentionUntil: transcriptMetadata.retentionUntil.toISOString() }
          : !transcriptPermission.allowed
            ? { status: "RESTRICTED" as const, visible: false, canManage: transcriptManagePermission.allowed, version: transcriptMetadata.version, transcriptText: null, summary: null, policyVersion: null, consentRecordedAt: transcriptMetadata.consentRecordedAt.toISOString(), retentionUntil: transcriptMetadata.retentionUntil.toISOString() }
            : { status: "AVAILABLE" as const, visible: true, canManage: transcriptManagePermission.allowed, version: transcriptMetadata.version, transcriptText: transcriptArtifact?.transcriptText ?? null, summary: transcriptArtifact?.summary ?? null, policyVersion: transcriptArtifact?.policyVersion ?? null, consentRecordedAt: transcriptMetadata.consentRecordedAt.toISOString(), retentionUntil: transcriptMetadata.retentionUntil.toISOString() },
    });
  }

  async function recordTranscript(context: AuthenticatedContext, payload: unknown) {
    const parsed = transcriptSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const meeting = await getMeetingForAuthorization(parsed.data.meetingId, context.workspaceId);
    await options.authorization.assertAuthorized(context, PermissionKeys.MEETING_TRANSCRIPTS_MANAGE, meetingResource(context.workspaceId, meeting));
    const consentRecordedAt = new Date(parsed.data.consentRecordedAt);
    const retentionUntil = new Date(parsed.data.retentionUntil);
    const now = options.now();
    if (consentRecordedAt > now) invalidInput("O consentimento não pode estar no futuro.");
    if (retentionUntil <= now) invalidInput("A retenção aprovada deve terminar no futuro.");
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meeting-transcript:${context.workspaceId}:${meeting.id}`}, 0))`;
      const latest = await transaction.meetingTranscriptArtifact.findFirst({ where: { workspaceId: context.workspaceId, meetingId: meeting.id }, orderBy: { version: "desc" }, select: { version: true } });
      const artifact = await transaction.meetingTranscriptArtifact.create({ data: { workspaceId: context.workspaceId, meetingId: meeting.id, version: (latest?.version ?? 0) + 1, transcriptText: parsed.data.transcriptText ?? null, summary: parsed.data.summary ?? null, policyVersion: parsed.data.policyVersion, consentEvidence: parsed.data.consentEvidence, consentRecordedAt, retentionUntil, createdByActorId: context.actorId, createdAt: now } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "meeting.transcript.recorded", entityType: "MeetingTranscriptArtifact", entityId: artifact.id, occurredAt: now, changes: { meetingId: meeting.id, version: artifact.version, policyVersion: artifact.policyVersion, consentRecordedAt: consentRecordedAt.toISOString(), retentionUntil: retentionUntil.toISOString(), hasTranscript: Boolean(artifact.transcriptText), hasSummary: Boolean(artifact.summary), externalRecording: false } } });
      return { artifactId: artifact.id, meetingId: meeting.id, version: artifact.version, status: "AVAILABLE" as const, externalRecording: false as const };
    });
  }

  return Object.freeze({ getAgenda, getLeadMeetings, schedule, act, getBriefing, recordTranscript });
}

let service: ReturnType<typeof createMeetingService> | undefined;

export function getMeetingService() {
  service ??= createMeetingService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
    automationPublisher: getAutomationEngineService(),
  });
  return service;
}
