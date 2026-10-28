import { assertAdvertisingSchedulingAccess, getAdvertisingSchedulingAccess } from "@/modules/meetings/application/advertising-scheduling-access";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { reassignLeadInTransaction } from "@/modules/leads/application/lead-assignment-operation";
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
  GoogleCalendarAgendaItem,
  LeadMeetingsScreen,
  MeetingBriefing,
  MeetingHistoryItem,
  MeetingListItem,
} from "@/modules/meetings/domain/meeting-contracts";
import { recordOpportunityMeetingHeldInTransaction } from "@/modules/opportunities/application/opportunity-service";
import {
  recordCommercialMetricCorrectionInTransaction,
  recordCommercialMetricFactInTransaction,
} from "@/modules/metrics/application/commercial-metric-fact-writer";
import { stopColdCadenceInTransaction } from "@/modules/prospecting/application/prospecting-cadence-service";
import { reconcileStageMeetingBookingInTransaction } from "@/modules/metrics/application/stage-meeting-booking-credit";
import { enqueueGoogleCalendarSyncInTransaction } from "@/modules/integrations/application/google-calendar-service";
import {
  cancelMeetingParticipantEmailsInTransaction,
  scheduleMeetingParticipantEmailsInTransaction,
} from "@/modules/meetings/application/meeting-participant-email-service";
import {
  transitionLeadStageInTransaction,
} from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { prospectingOperationPipelineNames } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { pactoDimensionLabels } from "@/modules/qualification/domain/pacto-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { AccessRoleKeys, PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { isWorkspaceMeetingScheduler } from "@/modules/users/permissions/meeting-scheduler-policy";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
  workspaceLocalDateTimeAt,
  workspaceDayRange,
  workspaceWeekRange,
} from "@/shared/core/time/workspace-time";
import { z } from "zod";
import { meetingGuests, participantEmailSchema, participantEmailsSchema } from "@/modules/meetings/domain/meeting-participants";

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
const leadDestinationSchema = z.enum(["MEETING_COMPLETED", "PROPOSAL"]);

const agendaQuerySchema = z.object({
  view: z.enum(["day", "week"]).default("day"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closerId: z.string().uuid().optional().default(""),
}).strict();

const leadMeetingsQuerySchema = z.object({ leadId: z.string().uuid() }).strict();
const meetingQuerySchema = z.object({ meetingId: z.string().uuid() }).strict();
const leadOptionSearchSchema = z.object({ query: z.string().trim().min(2).max(80) }).strict();
const scheduleSchema = z.object({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  closerId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  startsAtLocal: localDateTimeSchema,
  durationMinutes: z.union([z.literal(30), z.literal(40)]),
  observation: z.string().trim().max(5_000).nullable().optional(),
  participantEmail: participantEmailSchema.nullable().optional(),
  participantEmails: participantEmailsSchema.optional(),
  taskPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
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
    leadDestination: leadDestinationSchema.optional(),
    nextAction: nextActionSchema,
  }).strict(),
  z.object({
    action: z.literal("NO_SHOW"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2_000),
    nextAction: nextActionSchema,
  }).strict(),
  z.object({
    action: z.literal("EDIT"),
    meetingId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(2).max(200),
    startsAtLocal: localDateTimeSchema,
    durationMinutes: z.union([z.literal(30), z.literal(40)]),
    status: z.enum(["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
    observation: z.string().trim().max(5_000).nullable(),
    participantEmail: participantEmailSchema.nullable().optional(),
    participantEmails: participantEmailsSchema.optional(),
    outcome: z.string().trim().max(5_000).nullable(),
    leadDestination: leadDestinationSchema.optional(),
    reason: z.string().trim().min(3).max(2_000),
  }).strict(),
]).superRefine((value, context) => {
  if (
    value.action === "EDIT" &&
    (value.status === "COMPLETED" || value.status === "NO_SHOW") &&
    (!value.outcome || value.outcome.length < 3)
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Informe o resultado da reunião para este status.",
    });
  }
});

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
    participants: true;
    lead: { select: { fullName: true; pipeline: { select: { name: true } } } };
    owner: { select: { user: { select: { displayName: true } } } };
    createdBy: { select: { displayName: true } };
    calendarLinks: { select: { syncState: true }; take: 1 };
    googleCalendarLink: { select: { syncState: true; conferenceUrl: true } };
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
    scheduledByName: row.createdBy.displayName,
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
    participantEmail: row.participantEmail,
    participantResponseStatus: row.participantResponseStatus,
    participantResponseUpdatedAt: row.participantResponseUpdatedAt?.toISOString() ?? null,
    participants: meetingGuests(row).map((guest) => ({ ...guest, responseUpdatedAt: guest.responseUpdatedAt?.toISOString() ?? null })),
    revision: row.revision,
    canWrite,
    canChooseLeadDestination: row.lead.pipeline.name === ADVERTISING_PIPELINE_NAME,
    calendarSync: row.googleCalendarLink
      ? { state: row.googleCalendarLink.syncState, externalEgress: true, conferenceUrl: row.googleCalendarLink.conferenceUrl }
      : { state: (row.calendarLinks[0]?.syncState ?? "NOT_LINKED") as MeetingListItem["calendarSync"]["state"], externalEgress: false, conferenceUrl: null },
  });
}

function serializeGoogleCalendarEvent(
  row: Prisma.GoogleCalendarImportedEventGetPayload<{
    include: {
      account: { select: { googleEmail: true } };
      member: { select: { user: { select: { displayName: true } } } };
    };
  }>,
  viewerMemberId: string,
): GoogleCalendarAgendaItem {
  const privateForViewer = row.visibility === "private" && row.memberId !== viewerMemberId;
  return Object.freeze({
    id: row.id,
    ownerMemberId: row.memberId,
    ownerName: row.member.user.displayName,
    calendarEmail: row.account.googleEmail,
    title: privateForViewer ? "Compromisso privado" : row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    timeZone: row.timeZone,
    location: privateForViewer ? null : row.location,
    externalStatus: row.externalStatus,
    eventType: row.eventType,
    scheduledByName: privateForViewer
      ? row.member.user.displayName
      : row.creatorName ?? row.creatorEmail ?? row.account.googleEmail,
    externalHtmlLink: privateForViewer ? null : row.externalHtmlLink,
    conferenceUrl: privateForViewer ? null : row.conferenceUrl,
    private: privateForViewer,
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

function activeProspectingMeetingStage(status: MeetingStatus) {
  if (status === "COMPLETED") return "active-prospecting.meeting-completed";
  if (status === "CANCELLED" || status === "NO_SHOW") return "active-prospecting.meeting-no-show";
  return "active-prospecting.meeting-scheduled";
}

async function syncActiveProspectingMeetingStageInTransaction(
  transaction: Prisma.TransactionClient,
  context: Pick<AuthenticatedContext, "workspaceId" | "actorId">,
  input: Readonly<{
    leadId: string;
    pipelineId: string;
    currentStageId: string;
    meetingId: string;
    status: MeetingStatus;
    occurredAt: Date;
    leadDestination?: z.infer<typeof leadDestinationSchema>;
    managerCorrection?: boolean;
  }>,
) {
  const pipeline = await transaction.pipeline.findFirst({
    where: {
      id: input.pipelineId,
      workspaceId: context.workspaceId,
      entityType: "LEAD",
      name: { in: [...prospectingOperationPipelineNames] },
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!pipeline) return;
  if (pipeline.name === ADVERTISING_PIPELINE_NAME && await transaction.pipelineStage.findFirst({ where: { workspaceId: context.workspaceId, id: input.currentStageId, leadStageCode: "CLIENT" }, select: { id: true } })) return;
  if (input.leadDestination === "PROPOSAL" && pipeline.name !== ADVERTISING_PIPELINE_NAME) {
    invalidInput("O destino Proposta pelo resultado da reunião está disponível em Anúncios.");
  }
  const stableKey = input.status === "COMPLETED" && input.leadDestination === "PROPOSAL"
    ? "active-prospecting.proposal"
    : activeProspectingMeetingStage(input.status);
  const target = await transaction.pipelineStage.findFirst({
    where: {
      workspaceId: context.workspaceId,
      pipelineId: pipeline.id,
      stableKey,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!target) {
    conflict("PIPELINE_CONFIGURATION_INVALID", `A etapa ${stableKey} não está configurada.`);
  }
  if (target.id === input.currentStageId) return;
  return transitionLeadStageInTransaction(transaction, context, {
    leadId: input.leadId,
    targetStageId: target.id,
    reason: `Reunião ${input.meetingId} atualizada para ${statusLabel(input.status)}.`,
    origin: "MEETING",
    managerCorrection: input.managerCorrection ?? false,
    confirmed: true,
    ...(stableKey === "active-prospecting.proposal" ? { commercialEvent: "MEETING_COMPLETED" as const } : {}),
  }, input.occurredAt);
}

function historyAction(input: z.output<typeof actionSchema>): MeetingHistoryAction {
  if (input.action === "EDIT") {
    return ({
      SCHEDULED: "RESCHEDULED",
      CONFIRMED: "CONFIRMED",
      COMPLETED: "ATTENDED",
      CANCELLED: "CANCELLED",
      NO_SHOW: "NO_SHOW",
    } satisfies Record<MeetingStatus, MeetingHistoryAction>)[input.status];
  }
  return ({
    CONFIRM: "CONFIRMED",
    RESCHEDULE: "RESCHEDULED",
    CANCEL: "CANCELLED",
    ATTENDED: "ATTENDED",
    NO_SHOW: "NO_SHOW",
  } as const)[input.action];
}

function meetingEventType(input: z.output<typeof actionSchema>) {
  if (input.action === "EDIT") {
    return ({
      SCHEDULED: "MEETING_RESCHEDULED",
      CONFIRMED: "MEETING_CONFIRMED",
      COMPLETED: "MEETING_COMPLETED",
      CANCELLED: "MEETING_CANCELLED",
      NO_SHOW: "MEETING_NO_SHOW",
    } as const)[input.status];
  }
  return ({
    CONFIRM: "MEETING_CONFIRMED",
    RESCHEDULE: "MEETING_RESCHEDULED",
    CANCEL: "MEETING_CANCELLED",
    ATTENDED: "MEETING_COMPLETED",
    NO_SHOW: "MEETING_NO_SHOW",
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

  function schedulingScope(context: AuthenticatedContext, decision: AuthorizationDecision): PermissionScope | null {
    if (!decision.allowed) return null;
    return context.roleKey === AccessRoleKeys.SDR || isWorkspaceMeetingScheduler(context)
      ? "WORKSPACE"
      : decision.scope;
  }

  async function leadOptions(context: AuthenticatedContext, query = "") {
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
    const phoneDigits = /^[+0-9().\s-]+$/.test(query) ? query.replace(/\D/g, "") : "";
    const rows = await options.database.lead.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        AND: [
          leadVisibilityWhere(context, visibility),
          ...(query ? [{ OR: [
            { fullName: { contains: query, mode: "insensitive" as const } },
            ...(phoneDigits.length >= 2 ? [{ normalizedPhone: { contains: phoneDigits } }] : []),
          ] }] : []),
        ],
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: query ? 20 : 200,
      select: { id: true, fullName: true, normalizedPhone: true, opportunities: { where: { status: "OPEN", deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, name: true } } },
    });
    return rows.map((row) => ({ id: row.id, name: row.fullName, phone: row.normalizedPhone, opportunities: row.opportunities }));
  }

  async function searchLeadOptions(context: AuthenticatedContext, payload: unknown) {
    const parsed = leadOptionSearchSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    return leadOptions(context, parsed.data.query);
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
    const [visibleClosers, writeDecision, leads] = await Promise.all([
      closerOptions(context, readDecision.scope),
      options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, {
        workspaceId: context.workspaceId,
        resourceType: "MeetingAgenda",
        memberId: context.memberId,
      }),
      leadOptions(context),
    ]);
    const scheduleScope = schedulingScope(context, writeDecision);
    const schedulingClosers = scheduleScope ? await closerOptions(context, scheduleScope) : [];
    const allowedCloserIds = new Set(visibleClosers.map((closer) => closer.id));
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
    const externalOwnerFilter = parsed.data.closerId
      ? { memberId: parsed.data.closerId }
      : readDecision.scope === "OWN"
        ? { memberId: context.memberId }
        : readDecision.scope === "TEAM"
          ? { memberId: { in: [...allowedCloserIds] } }
          : {};
    const [rows, externalRows] = await Promise.all([
      options.database.meeting.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          startsAt: { gte: range.start, lt: range.end },
          ...ownerFilter,
        },
        include: {
          lead: { select: { fullName: true, pipeline: { select: { name: true } } } },
          owner: { select: { user: { select: { displayName: true } } } },
          createdBy: { select: { displayName: true } },
          calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
          googleCalendarLink: { select: { syncState: true, conferenceUrl: true } },
          participants: { orderBy: { position: "asc" } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
      options.database.googleCalendarImportedEvent.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          startsAt: { lt: range.end },
          endsAt: { gt: range.start },
          ...externalOwnerFilter,
        },
        include: {
          account: { select: { googleEmail: true } },
          member: { select: { user: { select: { displayName: true } } } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const permissions = await Promise.all(rows.map((row) =>
      options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, meetingResource(context.workspaceId, row)),
    ));
    const canSchedule = writeDecision.allowed && leads.length > 0 && schedulingClosers.length > 0;
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
      closerOptions: visibleClosers,
      schedulingCloserOptions: schedulingClosers,
      leadOptions: leads,
      meetings: rows.map((row, index) => serializeMeeting(row, options.now(), permissions[index]?.allowed ?? false)),
      externalEvents: externalRows.map((row) => serializeGoogleCalendarEvent(row, context.memberId)),
    });
  }

  async function getLeadMeetings(context: AuthenticatedContext, payload: unknown): Promise<LeadMeetingsScreen> {
    const parsed = leadMeetingsQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        pipeline: { select: { name: true } },
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
          lead: { select: { fullName: true, pipeline: { select: { name: true } } } },
          owner: { select: { user: { select: { displayName: true } } } },
          createdBy: { select: { displayName: true } },
          calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
          googleCalendarLink: { select: { syncState: true, conferenceUrl: true } },
          participants: { orderBy: { position: "asc" } },
          history: {
            orderBy: [{ meetingRevision: "desc" }],
            include: { recordedBy: { select: { displayName: true } } },
          },
        },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const advertisingAccess = lead.pipeline.name !== "Anúncios" || Boolean(await getAdvertisingSchedulingAccess(options.database, context));
    const scheduleScope = advertisingAccess ? schedulingScope(context, write) : null;
    const closers = scheduleScope ? await closerOptions(context, scheduleScope) : [];
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
    const leadScope = leadResource(context.workspaceId, lead);
    const writeDecision = await options.authorization.authorize(context, PermissionKeys.MEETINGS_WRITE, leadScope);
    if (!writeDecision.allowed) await options.authorization.assertAuthorized(context, PermissionKeys.MEETINGS_WRITE, leadScope);
    const targetScope = schedulingScope(context, writeDecision);
    const allowedClosers = targetScope ? await closerOptions(context, targetScope) : [];
    if (!allowedClosers.some((closer) => closer.id === parsed.data.closerId)) {
      throw new ApplicationError("Você não pode agendar reuniões para este vendedor.", { code: "MEETING_OWNER_SCOPE_DENIED", statusCode: 403, expose: true });
    }

    return options.database.$transaction(async (transaction) => {
      await lockCloser(transaction, context.workspaceId, parsed.data.closerId);
      // Booking and ownership must serialize even when two different closers are selected.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-distribution:${context.workspaceId}:${lead.id}`}, 0))`;
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
      const currentLead = await transaction.lead.findFirst({
        where: { id: lead.id, workspaceId: context.workspaceId, deletedAt: null },
        select: {
          id: true,
          ownerMemberId: true,
          queueId: true,
          pipelineId: true,
          pipeline: { select: { name: true } },
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
      const schedulingPolicy = currentLead.pipeline.name === ADVERTISING_PIPELINE_NAME
        ? await assertAdvertisingSchedulingAccess(transaction, context) : "EXISTING_FLOW";
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
      const participantEmails = parsed.data.participantEmails ?? (parsed.data.participantEmail ? [parsed.data.participantEmail] : []);
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
          participantEmail: participantEmails[0] ?? null,
          participantResponseStatus: participantEmails.length ? "NEEDS_ACTION" : null,
          participants: { create: participantEmails.map((email, position) => ({ email, position })) },
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
          priority: parsed.data.taskPriority ?? "HIGH",
          dueAt: startsAt,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      const meetingHistory = await transaction.meetingHistory.create({
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
      const meetingFactDimensions = {
        workspaceId: context.workspaceId,
        occurredAt,
        leadId: currentLead.id,
        opportunityId,
        meetingId: meeting.id,
        activityId: activity.id,
        creditedMemberId: context.memberId,
        performedByMemberId: context.memberId,
        bookedByMemberId: context.memberId,
        meetingOwnerMemberIdAtEvent: closer.id,
        leadOwnerMemberIdAtEvent: currentLead.ownerMemberId,
        executionMode: "MANUAL" as const,
      };
      const bookingCredit = await recordCommercialMetricFactInTransaction(transaction, {
        ...meetingFactDimensions,
        eventKey: `meeting-history:${meetingHistory.id}:scheduled:v1`,
        eventType: "MEETING_SCHEDULED",
        sourceEntityType: "MeetingHistory",
        sourceEntityId: meetingHistory.id,
      });
      await reconcileStageMeetingBookingInTransaction(transaction, bookingCredit.fact);
      await recordCommercialMetricFactInTransaction(transaction, {
        ...meetingFactDimensions,
        eventKey: `task:${task.id}:created:v1`,
        eventType: "TASK_CREATED",
        sourceEntityType: "Task",
        sourceEntityId: task.id,
        taskId: task.id,
        creditedMemberId: closer.id,
        taskKind: "MEETING",
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
            schedulingPolicy,
            closerId: closer.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: parsed.data.durationMinutes,
            taskId: task.id,
            activityId: activity.id,
            participantConfigured: participantEmails.length > 0,
            participantCount: participantEmails.length,
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
      if (currentLead.pipeline.name === ADVERTISING_PIPELINE_NAME && currentLead.ownerMemberId !== closer.id) {
        await reassignLeadInTransaction(transaction, {
          workspaceId: context.workspaceId, actorId: context.actorId, leadId: currentLead.id, targetMemberId: closer.id,
          ...(currentLead.ownerMemberId ? { expectedOwnerMemberId: currentLead.ownerMemberId } : {}),
          reason: `Reunião ${meeting.id} agendada: lead de Anúncios atribuído ao vendedor responsável pela reunião.`,
          type: "REDISTRIBUTION", requireGeneralQueueOrigin: false, requireTargetAvailability: false, assignedAt: occurredAt,
        });
      }
      await stopColdCadenceInTransaction(transaction, {
        workspaceId: context.workspaceId,
        leadId: currentLead.id,
        actorId: context.actorId,
        reason: "MEETING_SCHEDULED",
        occurredAt,
      });
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
      await scheduleMeetingParticipantEmailsInTransaction(transaction, {
        workspaceId: context.workspaceId,
        meetingId: meeting.id,
        meetingRevision: meeting.revision,
        participantEmails,
        startsAt,
        occurredAt,
        actorId: context.actorId,
        includeInvitation: true,
      });
      await enqueueGoogleCalendarSyncInTransaction(transaction, {
        workspaceId: context.workspaceId,
        meetingId: meeting.id,
        ownerMemberId: closer.id,
        meetingRevision: meeting.revision,
        actorId: context.actorId,
        now: occurredAt,
      });
      await options.beforeCommit?.();
      return Object.freeze({ meetingId: meeting.id, taskId: task.id, revision: meeting.revision });
    });
  }

  type PipelineMove = Readonly<{ leadId: string; targetStageId: string; expectedLeadUpdatedAt: Date; managerCorrection: boolean }>;

  async function executeAction(context: AuthenticatedContext, payload: unknown, pipelineMove?: PipelineMove) {
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const authorizedMeeting = await getMeetingForAuthorization(parsed.data.meetingId, context.workspaceId);
    await authorizeMeetingOrLead(context, PermissionKeys.MEETINGS_WRITE, authorizedMeeting);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await lockCloser(transaction, context.workspaceId, authorizedMeeting.ownerMemberId);
      if (pipelineMove) await transaction.$queryRaw`SELECT id FROM leads WHERE id = ${pipelineMove.leadId}::uuid AND "workspaceId" = ${context.workspaceId}::uuid FOR UPDATE`;
      const meeting = await transaction.meeting.findFirst({
        where: { id: parsed.data.meetingId, workspaceId: context.workspaceId, deletedAt: null },
        include: { participants: { orderBy: { position: "asc" } }, lead: { select: { ownerMemberId: true, queueId: true, pipelineId: true, currentStageId: true, updatedAt: true, pipeline: { select: { name: true } } } } },
      });
      if (!meeting) notFound("Reunião não encontrada.");
      if (pipelineMove) {
        if (meeting.leadId !== pipelineMove.leadId || meeting.lead.pipeline.name !== ADVERTISING_PIPELINE_NAME) notFound("Reunião de Anúncios não encontrada.");
        if (meeting.lead.updatedAt.getTime() !== pipelineMove.expectedLeadUpdatedAt.getTime()) conflict("LEAD_VERSION_CONFLICT", "Este lead mudou. Recarregue antes de alterar a etapa.");
        const destination = await transaction.pipelineStage.findFirst({ where: { id: pipelineMove.targetStageId, workspaceId: context.workspaceId, pipelineId: meeting.lead.pipelineId, deletedAt: null, leadStageCode: parsed.data.action === "EDIT" && parsed.data.status === "COMPLETED" ? "MEETING_COMPLETED" : "MEETING_NO_SHOW" } });
        if (!destination) notFound("Etapa de resultado não encontrada.");
        if (meeting.startsAt > now) conflict("MEETING_NOT_STARTED", "Registre o resultado somente após o início da reunião.");
      }
      if (meeting.revision !== parsed.data.expectedRevision) {
        conflict("MEETING_VERSION_CONFLICT", "A reunião mudou. Recarregue antes de continuar.");
      }
      if (parsed.data.action !== "EDIT" && meeting.status !== "SCHEDULED" && meeting.status !== "CONFIRMED") {
        conflict("MEETING_ALREADY_CLOSED", "A reunião já possui um resultado final.");
      }
      if (
        !pipelineMove && parsed.data.action === "EDIT" &&
        (meeting.status === "SCHEDULED" || meeting.status === "CONFIRMED") &&
        parsed.data.status !== meeting.status
      ) {
        conflict("MEETING_STATUS_ACTION_REQUIRED", "Use as ações da reunião para alterar o status enquanto ela estiver aberta.");
      }
      const correctedHistory = parsed.data.action === "EDIT" && (!pipelineMove || meeting.status !== "SCHEDULED" && meeting.status !== "CONFIRMED")
        ? await transaction.meetingHistory.findFirst({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id, meetingRevision: meeting.revision },
        })
        : null;

      let newStatus: MeetingStatus = meeting.status;
      let startsAt = meeting.startsAt;
      let endsAt = meeting.endsAt;
      let title = meeting.title;
      let observation = meeting.observation;
      const currentGuests = meetingGuests(meeting);
      let participantEmails = currentGuests.map((guest) => guest.email);
      let reason: string | null = null;
      let outcome: string | null = null;
      if (parsed.data.action === "EDIT") {
        title = parsed.data.title;
        observation = parsed.data.observation;
        participantEmails = parsed.data.participantEmails ?? (parsed.data.participantEmail === undefined
          ? participantEmails
          : [...new Set([...(parsed.data.participantEmail ? [parsed.data.participantEmail] : []), ...participantEmails.filter((email) => email !== meeting.participantEmail)])]);
        if (!pipelineMove) {
          startsAt = parseWorkspaceLocalDateTime(parsed.data.startsAtLocal, meeting.timeZone);
          endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60_000);
        }
        newStatus = parsed.data.status;
        reason = parsed.data.reason;
        outcome = parsed.data.status === "COMPLETED" || parsed.data.status === "NO_SHOW"
          ? parsed.data.outcome
          : null;
      } else if (parsed.data.action === "CONFIRM") {
        if (meeting.status === "CONFIRMED") conflict("MEETING_ALREADY_CONFIRMED", "A reunião já está confirmada.");
        newStatus = "CONFIRMED";
      } else if (parsed.data.action === "RESCHEDULE") {
        startsAt = parseWorkspaceLocalDateTime(parsed.data.startsAtLocal, meeting.timeZone);
        endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60_000);
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

      const participantEmail = participantEmails[0] ?? null;
      const metricOccurredAt = meeting.lead.pipeline.name === ADVERTISING_PIPELINE_NAME && parsed.data.action === "EDIT" && newStatus === meeting.status
        ? newStatus === "COMPLETED" ? meeting.completedAt ?? now : newStatus === "NO_SHOW" ? meeting.noShowAt ?? now : now
        : now;
      const primaryGuest = currentGuests.find((guest) => guest.email === participantEmail);
      await transaction.meetingParticipant.deleteMany({ where: { workspaceId: context.workspaceId, meetingId: meeting.id, email: { notIn: participantEmails } } });
      for (const [position, email] of participantEmails.entries()) {
        const guest = currentGuests.find((item) => item.email === email);
        await transaction.meetingParticipant.upsert({
          where: { workspaceId_meetingId_email: { workspaceId: context.workspaceId, meetingId: meeting.id, email } },
          create: { workspaceId: context.workspaceId, meetingId: meeting.id, email, position, responseStatus: guest?.responseStatus ?? "NEEDS_ACTION", responseUpdatedAt: guest?.responseUpdatedAt ?? null },
          update: { position },
        });
      }
      const updated = await transaction.meeting.update({
        where: { id: meeting.id },
        data: {
          title,
          status: newStatus,
          startsAt,
          endsAt,
          durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
          observation,
          outcome,
          participantEmail,
          participantResponseStatus: participantEmail ? primaryGuest?.responseStatus ?? "NEEDS_ACTION" : null,
          participantResponseUpdatedAt: primaryGuest?.responseUpdatedAt ?? null,
          confirmedAt: newStatus === "CONFIRMED" ? meeting.confirmedAt ?? now : newStatus === "SCHEDULED" ? null : meeting.confirmedAt,
          cancelledAt: newStatus === "CANCELLED" ? meeting.cancelledAt ?? now : null,
          completedAt: newStatus === "COMPLETED" ? meeting.completedAt ?? now : null,
          noShowAt: newStatus === "NO_SHOW" ? meeting.noShowAt ?? now : null,
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: now,
        },
      });

      const meetingHistory = await transaction.meetingHistory.create({
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
      } else if (parsed.data.action === "EDIT" && (newStatus === "SCHEDULED" || newStatus === "CONFIRMED")) {
        await transaction.task.updateMany({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id, deletedAt: null },
          data: {
            status: "OPEN",
            dueAt: startsAt,
            completedAt: null,
            result: null,
            updatedByActorId: context.actorId,
            updatedAt: now,
          },
        });
      }
      let recoveryTaskId: string | null = null;
      if (
        parsed.data.action === "CANCEL" ||
        parsed.data.action === "ATTENDED" ||
        parsed.data.action === "NO_SHOW" ||
        (parsed.data.action === "EDIT" && newStatus !== "SCHEDULED" && newStatus !== "CONFIRMED")
      ) {
        await transaction.task.updateMany({
          where: {
            workspaceId: context.workspaceId,
            meetingId: meeting.id,
            ...(parsed.data.action === "EDIT" ? {} : { status: { in: ["OPEN", "IN_PROGRESS"] as const } }),
            deletedAt: null,
          },
          data: {
            status: newStatus === "COMPLETED" ? "COMPLETED" : "CANCELLED",
            completedAt: newStatus === "COMPLETED" ? metricOccurredAt : null,
            result: outcome ?? reason,
            updatedByActorId: context.actorId,
            updatedAt: now,
          },
        });
      }
      if (
        parsed.data.action === "CANCEL" ||
        parsed.data.action === "ATTENDED" ||
        parsed.data.action === "NO_SHOW"
      ) {
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
      const leadTransition = await syncActiveProspectingMeetingStageInTransaction(transaction, context, {
        leadId: meeting.leadId,
        pipelineId: meeting.lead.pipelineId,
        currentStageId: meeting.lead.currentStageId,
        meetingId: meeting.id,
        status: newStatus,
        occurredAt: now,
        ...(pipelineMove ? { managerCorrection: pipelineMove.managerCorrection } : {}),
        ...((parsed.data.action === "ATTENDED" || parsed.data.action === "EDIT") && parsed.data.leadDestination
          ? { leadDestination: parsed.data.leadDestination } : {}),
      });
      if (pipelineMove && !leadTransition) conflict("STAGE_UNCHANGED", "O lead já está nesta etapa.");
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
      const correctedActivity = parsed.data.action === "EDIT" && (!pipelineMove || correctedHistory)
        ? await transaction.activity.findFirst({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id, deletedAt: null },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        })
        : null;
      const activityResult = parsed.data.action === "EDIT"
        ? pipelineMove ? newStatus === "COMPLETED" ? "COMPLETED" : "NO_SHOW" : "CORRECTED"
        : ({
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
          subject: parsed.data.action === "EDIT" && !pipelineMove
            ? `Correção da reunião: ${title}`
            : `Reunião ${statusLabel(newStatus)}: ${title}`,
          description: parsed.data.action === "EDIT" ? reason : outcome ?? reason,
          occurredAt: now,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues: {
            status: meeting.status,
            title: meeting.title,
            startsAt: meeting.startsAt.toISOString(),
            endsAt: meeting.endsAt.toISOString(),
            observation: meeting.observation,
            outcome: meeting.outcome,
            revision: meeting.revision,
          },
          newValues: {
            status: newStatus,
            title,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            observation,
            outcome,
            revision: updated.revision,
            ...((parsed.data.action === "ATTENDED" || parsed.data.action === "EDIT") && parsed.data.leadDestination
              ? { leadDestination: parsed.data.leadDestination } : {}),
          },
          correctsActivityId: correctedActivity?.id ?? null,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: now,
          updatedAt: now,
        },
      });
      const eventType = meetingEventType(parsed.data);
      if (parsed.data.action === "EDIT" && correctedHistory) {
        const originalFact = await transaction.commercialMetricFact.findFirst({
          where: {
            workspaceId: context.workspaceId,
            sourceEntityType: "MeetingHistory",
            sourceEntityId: correctedHistory.id,
            correctionOfFactId: null,
            quantity: { gt: 0 },
          },
        });
        // Editing a meeting corrects its current state, not the fact that it was booked.
        // Keep the original booking date and booker; reschedules are separate events.
        if (originalFact && originalFact.eventType !== "MEETING_SCHEDULED") {
          await recordCommercialMetricCorrectionInTransaction(transaction, {
            workspaceId: context.workspaceId,
            eventKey: `${originalFact.eventKey}:meeting-edit:${meetingHistory.id}:reversal:v1`,
            eventType: originalFact.eventType,
            occurredAt: originalFact.occurredAt,
            sourceEntityType: originalFact.sourceEntityType,
            sourceEntityId: originalFact.sourceEntityId,
            sourceRevision: originalFact.sourceRevision,
            leadId: originalFact.leadId,
            taskId: originalFact.taskId,
            activityId: activity.id,
            meetingId: originalFact.meetingId,
            opportunityId: originalFact.opportunityId,
            creditedMemberId: originalFact.creditedMemberId,
            performedByMemberId: context.memberId,
            leadOwnerMemberIdAtEvent: originalFact.leadOwnerMemberIdAtEvent,
            meetingOwnerMemberIdAtEvent: originalFact.meetingOwnerMemberIdAtEvent,
            result: originalFact.result,
            executionMode: "MANUAL",
            quantity: -originalFact.quantity,
            correctionOfFactId: originalFact.id,
            reversedAt: now,
            reversalReason: parsed.data.reason,
            safeMetadata: { correctionActivityId: activity.id, correctedMeetingRevision: meeting.revision },
          });
        }
      }
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `meeting-history:${meetingHistory.id}:${eventType.toLowerCase()}:v1`,
        eventType,
        occurredAt: metricOccurredAt,
        sourceEntityType: "MeetingHistory",
        sourceEntityId: meetingHistory.id,
        leadId: meeting.leadId,
        opportunityId: meeting.opportunityId,
        meetingId: meeting.id,
        activityId: activity.id,
        creditedMemberId: meeting.ownerMemberId,
        performedByMemberId: context.memberId,
        leadOwnerMemberIdAtEvent: meeting.lead.ownerMemberId,
        meetingOwnerMemberIdAtEvent: meeting.ownerMemberId,
        result: activityResult,
        executionMode: "MANUAL",
      });
      if (parsed.data.action === "ATTENDED" || parsed.data.action === "CANCEL" || parsed.data.action === "NO_SHOW" || parsed.data.action === "EDIT") {
        const meetingTask = await transaction.task.findFirst({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, assigneeMemberId: true, kind: true },
        });
        if (meetingTask && parsed.data.action === "EDIT" && correctedHistory) {
          const originalTaskFacts = await transaction.commercialMetricFact.findMany({
            where: {
              workspaceId: context.workspaceId,
              taskId: meetingTask.id,
              eventType: { in: ["TASK_COMPLETED", "TASK_CANCELLED"] },
              eventKey: { contains: `meeting:${correctedHistory.id}:v1` },
              correctionOfFactId: null,
              quantity: { gt: 0 },
            },
          });
          for (const originalFact of originalTaskFacts) {
            await recordCommercialMetricCorrectionInTransaction(transaction, {
              workspaceId: context.workspaceId,
              eventKey: `${originalFact.eventKey}:meeting-edit:${meetingHistory.id}:reversal:v1`,
              eventType: originalFact.eventType,
              occurredAt: originalFact.occurredAt,
              sourceEntityType: originalFact.sourceEntityType,
              sourceEntityId: originalFact.sourceEntityId,
              sourceRevision: originalFact.sourceRevision,
              leadId: originalFact.leadId,
              taskId: originalFact.taskId,
              activityId: activity.id,
              meetingId: originalFact.meetingId,
              opportunityId: originalFact.opportunityId,
              creditedMemberId: originalFact.creditedMemberId,
              performedByMemberId: context.memberId,
              leadOwnerMemberIdAtEvent: originalFact.leadOwnerMemberIdAtEvent,
              meetingOwnerMemberIdAtEvent: originalFact.meetingOwnerMemberIdAtEvent,
              taskKind: originalFact.taskKind,
              result: originalFact.result,
              executionMode: "MANUAL",
              quantity: -originalFact.quantity,
              correctionOfFactId: originalFact.id,
              reversedAt: now,
              reversalReason: parsed.data.reason,
              safeMetadata: { correctionActivityId: activity.id, correctedMeetingRevision: meeting.revision },
            });
          }
        }
        if (meetingTask && newStatus !== "SCHEDULED" && newStatus !== "CONFIRMED") {
          const taskEventType = newStatus === "COMPLETED" ? "TASK_COMPLETED" : "TASK_CANCELLED";
          await recordCommercialMetricFactInTransaction(transaction, {
            workspaceId: context.workspaceId,
            eventKey: `task:${meetingTask.id}:${taskEventType === "TASK_COMPLETED" ? "completed" : "cancelled"}:meeting:${meetingHistory.id}:v1`,
            eventType: taskEventType,
            occurredAt: metricOccurredAt,
            sourceEntityType: "Task",
            sourceEntityId: meetingTask.id,
            leadId: meeting.leadId,
            opportunityId: meeting.opportunityId,
            meetingId: meeting.id,
            taskId: meetingTask.id,
            creditedMemberId: meetingTask.assigneeMemberId,
            performedByMemberId: context.memberId,
            leadOwnerMemberIdAtEvent: meeting.lead.ownerMemberId,
            meetingOwnerMemberIdAtEvent: meeting.ownerMemberId,
            taskKind: meetingTask.kind,
            result: newStatus === "COMPLETED" ? "COMPLETED" : newStatus === "NO_SHOW" ? "NO_SHOW" : "CANCELLED",
            executionMode: "MANUAL",
          });
        }
      }
      if (recoveryTaskId) {
        await recordCommercialMetricFactInTransaction(transaction, {
          workspaceId: context.workspaceId,
          eventKey: `task:${recoveryTaskId}:created:v1`,
          eventType: "TASK_CREATED",
          occurredAt: now,
          sourceEntityType: "Task",
          sourceEntityId: recoveryTaskId,
          leadId: meeting.leadId,
          opportunityId: meeting.opportunityId,
          taskId: recoveryTaskId,
          creditedMemberId: meeting.opportunityId ? meeting.ownerMemberId : meeting.lead.ownerMemberId ?? meeting.ownerMemberId,
          performedByMemberId: context.memberId,
          leadOwnerMemberIdAtEvent: meeting.lead.ownerMemberId,
          taskKind: "FOLLOW_UP",
          executionMode: "MANUAL",
        });
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: parsed.data.action === "EDIT" ? "meeting.corrected" : `meeting.${historyAction(parsed.data).toLowerCase()}`,
          entityType: "Meeting",
          entityId: meeting.id,
          occurredAt: now,
          changes: {
            fromStatus: meeting.status,
            toStatus: newStatus,
            previousStartsAt: meeting.startsAt.toISOString(),
            newStartsAt: startsAt.toISOString(),
            previousTitle: meeting.title,
            newTitle: title,
            previousObservation: meeting.observation,
            newObservation: observation,
            participantChanged: JSON.stringify(participantEmails) !== JSON.stringify(currentGuests.map((guest) => guest.email)),
            participantCount: participantEmails.length,
            reason,
            outcome,
            activityId: activity.id,
          },
          metadata: { timeZone: meeting.timeZone, revision: updated.revision, ...(pipelineMove ? { origin: "PIPELINE", targetStageId: pipelineMove.targetStageId } : {}) },
        },
      });
      if ((parsed.data.action === "ATTENDED" || (parsed.data.action === "EDIT" && newStatus === "COMPLETED" && meeting.status !== "COMPLETED")) && meeting.opportunityId) {
        await recordOpportunityMeetingHeldInTransaction(
          transaction,
          context,
          meeting.opportunityId,
          now,
        );
      }
      if (options.automationPublisher && (parsed.data.action === "RESCHEDULE" || (parsed.data.action === "EDIT" && (newStatus === "SCHEDULED" || newStatus === "CONFIRMED")))) {
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
      } else if (options.automationPublisher && (parsed.data.action === "NO_SHOW" || (parsed.data.action === "EDIT" && newStatus === "NO_SHOW"))) {
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
        (parsed.data.action === "CANCEL" || parsed.data.action === "ATTENDED" || (parsed.data.action === "EDIT" && newStatus !== "SCHEDULED" && newStatus !== "CONFIRMED"))
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
      if (
        (newStatus === "SCHEDULED" || newStatus === "CONFIRMED") &&
        (parsed.data.action === "RESCHEDULE" || parsed.data.action === "EDIT")
      ) {
        await scheduleMeetingParticipantEmailsInTransaction(transaction, {
          workspaceId: context.workspaceId,
          meetingId: meeting.id,
          meetingRevision: updated.revision,
          participantEmails,
          startsAt,
          occurredAt: now,
          actorId: context.actorId,
          includeInvitation: true,
        });
      } else if (newStatus !== "SCHEDULED" && newStatus !== "CONFIRMED") {
        await cancelMeetingParticipantEmailsInTransaction(transaction, {
          workspaceId: context.workspaceId,
          meetingId: meeting.id,
          actorId: context.actorId,
          occurredAt: now,
          reasonCode: "MEETING_CLOSED",
        });
      }
      if (parsed.data.action === "EDIT" && meeting.status === "CANCELLED" && newStatus !== "CANCELLED") {
        await transaction.googleCalendarEventLink.updateMany({
          where: { workspaceId: context.workspaceId, meetingId: meeting.id },
          data: { syncedRevision: null, conferenceUrl: null },
        });
      }
      await enqueueGoogleCalendarSyncInTransaction(transaction, {
        workspaceId: context.workspaceId,
        meetingId: meeting.id,
        ownerMemberId: meeting.ownerMemberId,
        meetingRevision: updated.revision,
        actorId: context.actorId,
        now,
      });
      await options.beforeCommit?.();
      return Object.freeze({
        meetingId: meeting.id,
        status: updated.status,
        revision: updated.revision,
        startsAt: updated.startsAt.toISOString(),
        ...(pipelineMove ? { leadTransition } : {}),
      });
    });
  }

  async function act(context: AuthenticatedContext, payload: unknown) {
    return executeAction(context, payload);
  }

  async function recordPipelineOutcome(context: AuthenticatedContext, input: Readonly<{
    meetingId: string; expectedRevision: number; targetStageId: string; expectedLeadUpdatedAt: Date; status: "COMPLETED" | "NO_SHOW"; reason: string; managerCorrection: boolean;
  }>) {
    const meeting = await options.database.meeting.findFirst({ where: { workspaceId: context.workspaceId, id: input.meetingId, deletedAt: null } });
    if (!meeting) notFound("Reunião não encontrada.");
    const reason = `Resultado registrado pelo pipeline: ${input.reason}`;
    const result = await executeAction(context, {
      action: "EDIT", meetingId: meeting.id, expectedRevision: input.expectedRevision, title: meeting.title,
      startsAtLocal: workspaceLocalDateTimeAt(meeting.startsAt, meeting.timeZone), durationMinutes: meeting.durationMinutes,
      status: input.status, observation: meeting.observation, outcome: reason, reason,
    }, { leadId: meeting.leadId, targetStageId: input.targetStageId, expectedLeadUpdatedAt: input.expectedLeadUpdatedAt, managerCorrection: input.managerCorrection });
    return result.leadTransition!;
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
        createdBy: { select: { displayName: true } },
        opportunity: { select: { id: true, name: true, nextActionTaskId: true, nextActionAt: true, nextActionDescription: true } },
        calendarLinks: { select: { syncState: true }, take: 1, orderBy: { createdAt: "asc" } },
        googleCalendarLink: { select: { syncState: true, conferenceUrl: true } },
        participants: { orderBy: { position: "asc" } },
        lead: {
          include: {
            pipeline: { select: { name: true } },
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

  return Object.freeze({ getAgenda, getLeadMeetings, searchLeadOptions, schedule, act, recordPipelineOutcome, getBriefing, recordTranscript });
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
