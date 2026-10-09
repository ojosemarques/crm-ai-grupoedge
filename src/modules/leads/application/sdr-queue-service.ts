import type { PermissionScope, PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  leadVisibilitySql,
  resolveLeadVisibilityScope,
  type LeadVisibilityAuthorizationPort,
} from "@/modules/leads/application/lead-list-service";
import {
  getSdrQueueRecommendation,
  type SdrQueueBucket,
  type SdrQueueItem,
  type SdrQueueSection,
} from "@/modules/leads/domain/sdr-queue-contracts";
import { staleContactCutoff } from "@/modules/leads/domain/lead-operational-policy";
import { buildDailyGoalProgress } from "@/modules/goals/domain/daily-goal-contracts";
import { summarizeEffectiveContacts } from "@/modules/metrics/domain/effective-contact-metrics";
import { countUnresolvedCallAttempts } from "@/modules/metrics/domain/unresolved-call-attempts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { isBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import {
  buildProspectingDailyActionPlan,
  summarizeProspectingTaskResults,
  type ProspectingDailyActionRow,
} from "@/modules/prospecting/domain/prospecting-daily-metrics";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

const queueQuerySchema = z.object({
  memberId: z.string().uuid().optional(),
});

const sectionDefinitions: ReadonlyArray<Readonly<{
  key: SdrQueueBucket;
  title: string;
  description: string;
  limit: number;
}>> = [
  { key: "NOW", title: "Agora", description: "Ordem operacional completa para decidir o próximo atendimento.", limit: 20 },
  { key: "NEW", title: "Novos", description: "Leads na primeira etapa do pipeline.", limit: 8 },
  { key: "P1", title: "P1", description: "Prioridade vigente P1, com motivo rastreável.", limit: 8 },
  { key: "WAITING_CALL", title: "Aguardando ligação", description: "Tarefa aberta de ligação ou Ligar agora.", limit: 8 },
  { key: "RESPONDED", title: "Responderam", description: "Resposta recebida aguardando ação humana.", limit: 8 },
  { key: "RETURN_TODAY", title: "Retorno para hoje", description: "Próxima ação no dia do workspace.", limit: 8 },
  { key: "OVERDUE", title: "Atrasados", description: "Próxima ação com prazo vencido.", limit: 8 },
  { key: "MEETINGS_TODAY", title: "Reuniões de hoje", description: "Reuniões não canceladas no dia do workspace.", limit: 8 },
  { key: "STALE_CONTACT", title: "Sem contato recente", description: "Leads abertos sem ligação, mensagem ou e-mail nas últimas 72 horas.", limit: 8 },
  { key: "MISSING_NEXT_ACTION", title: "Sem próxima ação", description: "Erro operacional em lead aberto.", limit: 8 },
];

type SdrQueueServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: LeadVisibilityAuthorizationPort;
  now: () => Date;
}>;

type RawQueueRow = Readonly<{
  id: string;
  fullName: string;
  jobTitle: string | null;
  pain: string | null;
  priorityCode: string | null;
  score: number | null;
  priorityReason: string | null;
  responsibleName: string | null;
  responsibleType: string;
  pipelineName: string;
  stageName: string;
  stagePosition: number;
  receivedAt: Date;
  firstHumanAttemptAt: Date | null;
  slaSeconds: number | null;
  healthyMaxSeconds: number | null;
  attentionMaxSeconds: number | null;
  lastActivityAt: Date;
  lastActivitySubject: string | null;
  nextActionTaskId: string | null;
  nextActionAt: Date | null;
  nextActionDescription: string | null;
  nextActionKind: string | null;
  nextActionSourceKey: string | null;
  awaitingHumanResponse: boolean;
  lastInboundResponseAt: Date | null;
  meetingTodayId: string | null;
  meetingTodayStartsAt: Date | null;
  sectionTotal: number;
}>;

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(
    error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function callablePhoneSql(): Prisma.Sql {
  return Prisma.sql`
    l."contactPreference"::text <> 'DO_NOT_CONTACT'
    AND (
      NULLIF(BTRIM(l."normalizedPhone"), '') IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM "contact_points" phone_point
        WHERE phone_point."workspaceId" = l."workspaceId"
          AND phone_point."contactId" = l."contactId"
          AND phone_point."type"::text IN ('PHONE', 'WHATSAPP')
          AND phone_point."doNotContact" = FALSE
          AND NULLIF(BTRIM(phone_point."normalizedValue"), '') IS NOT NULL
          AND phone_point."deletedAt" IS NULL
      )
    )
  `;
}

function bucketSql(bucket: SdrQueueBucket, now: Date): Prisma.Sql {
  switch (bucket) {
    case "NOW":
      return Prisma.sql`TRUE`;
    case "NEW":
      return Prisma.sql`stage."position" = 0`;
    case "P1":
      return Prisma.sql`COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1'`;
    case "WAITING_CALL":
      return Prisma.sql`(${callablePhoneSql()}) AND EXISTS (
        SELECT 1 FROM "tasks" waiting_task
        WHERE waiting_task."workspaceId" = l."workspaceId"
          AND waiting_task."leadId" = l."id"
          AND waiting_task."kind"::text IN ('IMMEDIATE_CALL', 'CALL')
          AND waiting_task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND waiting_task."deletedAt" IS NULL
      )`;
    case "RESPONDED":
      return Prisma.sql`l."awaitingHumanResponse" = TRUE`;
    case "RETURN_TODAY":
      return Prisma.sql`l."nextActionAt" IS NOT NULL
        AND (l."nextActionAt" AT TIME ZONE workspace."timeZone")::date
          = (${now}::timestamptz AT TIME ZONE workspace."timeZone")::date`;
    case "OVERDUE":
      return Prisma.sql`l."nextActionAt" < ${now}`;
    case "MEETINGS_TODAY":
      return Prisma.sql`meeting_today."id" IS NOT NULL`;
    case "STALE_CONTACT":
      return Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "activities" recent_contact
        WHERE recent_contact."workspaceId" = l."workspaceId"
          AND recent_contact."leadId" = l."id"
          AND recent_contact."occurredAt" >= ${staleContactCutoff(now)}
          AND recent_contact."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'EMAIL')
          AND recent_contact."deletedAt" IS NULL
      )`;
    case "MISSING_NEXT_ACTION":
      return Prisma.sql`l."nextActionAt" IS NULL`;
  }
}

function operationalOrderSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN next_task."sourceKey" LIKE 'active-prospecting:%'
        AND next_task."kind"::text = 'CALL' THEN 0
      WHEN next_task."sourceKey" LIKE 'active-prospecting:%'
        AND next_task."kind"::text = 'INSTAGRAM_FOLLOW' THEN 1
      WHEN next_task."sourceKey" LIKE 'active-prospecting:%'
        AND next_task."kind"::text = 'INSTAGRAM_MESSAGE' THEN 2
      WHEN l."awaitingHumanResponse" OR meeting_today."id" IS NOT NULL THEN 4
      WHEN COALESCE(next_task."dueAt", l."nextActionAt") < ${now} THEN 5
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1' THEN 6
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P2' THEN 7
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P3' THEN 8
      ELSE 9
    END ASC,
    CASE WHEN l."awaitingHumanResponse" THEN l."lastInboundResponseAt" END DESC NULLS LAST,
    CASE WHEN stage."position" = 0 THEN latest_cycle."receivedAt" END ASC NULLS LAST,
    CASE WHEN COALESCE(next_task."dueAt", l."nextActionAt") < ${now} THEN COALESCE(next_task."dueAt", l."nextActionAt") END ASC NULLS LAST,
    COALESCE(next_task."dueAt", l."nextActionAt") ASC NULLS LAST,
    l."createdAt" ASC,
    l."id" ASC
  `;
}

function sdrOptionWhere(
  workspaceId: string,
  scope: PermissionScope,
  teamIds: readonly string[],
  memberId: string,
): Prisma.WorkspaceMemberWhereInput {
  return commercialMemberWhere({
    workspaceId,
    functions: ["SDR", "CLOSER"],
    ...(scope === "OWN" ? { memberId } : {}),
    ...(scope === "TEAM" ? { teamIds } : {}),
  });
}

function drilldownHref(
  bucket: SdrQueueBucket,
  memberId: string | null,
): string {
  const params = new URLSearchParams({
    operationalBucket: bucket,
    sort: "operational",
  });
  if (memberId) params.set("responsibles", `member:${memberId}`);
  return `/leads?${params.toString()}`;
}

export function createSdrQueueService(options: SdrQueueServiceOptions) {
  async function getScreen(context: AuthenticatedContext, payload: unknown) {
    const parsed = queueQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const now = options.now();
    const scope = await resolveLeadVisibilityScope(
      options.database,
      options.authorization,
      context,
      PermissionKeys.LEADS_READ,
    );
    const [workspace, members, manageDailyGoalsDecision] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      options.database.workspaceMember.findMany({
        where: sdrOptionWhere(
          context.workspaceId,
          scope.scope,
          scope.teamIds,
          context.memberId,
        ),
        orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          user: { select: { displayName: true, status: true } },
        },
      }),
      options.authorization.authorize(context, PermissionKeys.GOALS_MANAGE, {
        workspaceId: context.workspaceId,
        resourceType: "DailyGoalProfile",
      }),
    ]);
    if (
      parsed.data.memberId &&
      !members.some((member) => member.id === parsed.data.memberId)
    ) {
      await options.authorization.assertAuthorized(
        context,
        PermissionKeys.LEADS_READ,
        {
          workspaceId: context.workspaceId,
          resourceType: "SdrQueue",
          memberId: parsed.data.memberId,
        },
      );
      throw new AccessDeniedError();
    }
    const selectedMemberId =
      parsed.data.memberId ?? (scope.scope === "OWN" ? context.memberId : null);
    const dailyGoalMembers = manageDailyGoalsDecision.allowed
      ? await options.database.workspaceMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            status: "ACTIVE",
            deletedAt: null,
            user: { status: "ACTIVE", deletedAt: null },
          },
          orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
          select: { id: true, user: { select: { displayName: true } } },
        })
      : [];
    const productivityMemberIds = selectedMemberId
      ? [selectedMemberId]
      : members.filter((member) => member.status === "ACTIVE" && member.user.status === "ACTIVE").map((member) => member.id);
    const dailyGoalProfileMemberIds = manageDailyGoalsDecision.allowed
      ? dailyGoalMembers.map((member) => member.id)
      : productivityMemberIds;
    const memberFilter =
      selectedMemberId && scope.scope !== "OWN"
        ? Prisma.sql`AND l."ownerMemberId" = ${selectedMemberId}::uuid`
        : Prisma.empty;
    const slaSeconds = Prisma.sql`CASE
      WHEN latest_cycle."id" IS NULL THEN NULL
      ELSE COALESCE(
        latest_cycle."firstHumanAttemptSeconds",
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - latest_cycle."receivedAt")))::integer)
      )
    END`;
    const joins = Prisma.sql`
      FROM "leads" l
      JOIN "workspaces" workspace ON workspace."id" = l."workspaceId"
      JOIN "pipeline_stages" stage
        ON stage."workspaceId" = l."workspaceId" AND stage."id" = l."currentStageId"
      JOIN "pipelines" pipeline
        ON pipeline."workspaceId" = l."workspaceId" AND pipeline."id" = l."pipelineId"
      LEFT JOIN "workspace_members" owner
        ON owner."workspaceId" = l."workspaceId" AND owner."id" = l."ownerMemberId"
      LEFT JOIN "users" owner_user ON owner_user."id" = owner."userId"
      LEFT JOIN "queues" responsible_queue
        ON responsible_queue."workspaceId" = l."workspaceId" AND responsible_queue."id" = l."queueId"
      LEFT JOIN LATERAL (
        SELECT task."id", task."kind", task."sourceKey", task."dueAt", task."title"
        FROM "tasks" task
        WHERE task."workspaceId" = l."workspaceId"
          AND task."leadId" = l."id"
          AND task."sourceKey" LIKE 'active-prospecting:%'
          AND task."kind"::text IN ('CALL', 'INSTAGRAM_MESSAGE', 'INSTAGRAM_FOLLOW')
          AND (task."kind"::text <> 'CALL' OR (${callablePhoneSql()}))
          AND task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND task."deletedAt" IS NULL
        ORDER BY
          CASE
            WHEN task."sourceKey" LIKE 'active-prospecting:%:call-1' THEN 0
            WHEN task."sourceKey" LIKE 'active-prospecting:%:instagram-follow' THEN 1
            WHEN task."sourceKey" LIKE 'active-prospecting:%:instagram-message-1' THEN 2
            ELSE 3
          END,
          task."dueAt",
          task."id"
        LIMIT 1
      ) next_task ON TRUE
      LEFT JOIN "lead_current_scores" current_score
        ON current_score."workspaceId" = l."workspaceId"
        AND current_score."leadId" = l."id"
      LEFT JOIN "lead_scores" latest_score
        ON latest_score."workspaceId" = current_score."workspaceId"
        AND latest_score."leadId" = current_score."leadId"
        AND latest_score."id" = current_score."leadScoreId"
      LEFT JOIN LATERAL (
        SELECT
          cycle_row."id",
          cycle_row."receivedAt",
          cycle_row."firstHumanAttemptAt",
          cycle_row."firstHumanAttemptSeconds",
          priority_band."code"::text AS "priorityCode",
          priority_band."name" AS "priorityName",
          policy."healthyMaxSeconds",
          policy."attentionMaxSeconds"
        FROM "lead_sla_cycles" cycle_row
        JOIN "lead_priority_bands" priority_band
          ON priority_band."workspaceId" = cycle_row."workspaceId"
          AND priority_band."id" = cycle_row."priorityBandId"
        JOIN "sla_policies" policy
          ON policy."workspaceId" = priority_band."workspaceId"
          AND policy."id" = priority_band."slaPolicyId"
        WHERE cycle_row."workspaceId" = l."workspaceId" AND cycle_row."leadId" = l."id"
        ORDER BY cycle_row."receivedAt" DESC, cycle_row."id" DESC
        LIMIT 1
      ) latest_cycle ON TRUE
      LEFT JOIN LATERAL (
        SELECT activity."subject"
        FROM "activities" activity
        WHERE activity."workspaceId" = l."workspaceId"
          AND activity."leadId" = l."id"
          AND activity."deletedAt" IS NULL
        ORDER BY activity."occurredAt" DESC, activity."id" DESC
        LIMIT 1
      ) latest_activity ON TRUE
      LEFT JOIN LATERAL (
        SELECT meeting."id", meeting."startsAt"
        FROM "meetings" meeting
        WHERE meeting."workspaceId" = l."workspaceId"
          AND meeting."leadId" = l."id"
          AND meeting."status"::text <> 'CANCELLED'
          AND meeting."deletedAt" IS NULL
          AND (meeting."startsAt" AT TIME ZONE workspace."timeZone")::date
            = (${now}::timestamptz AT TIME ZONE workspace."timeZone")::date
        ORDER BY meeting."startsAt", meeting."id"
        LIMIT 1
      ) meeting_today ON TRUE
    `;
    const baseWhere = Prisma.sql`
      l."workspaceId" = ${context.workspaceId}::uuid
      AND l."deletedAt" IS NULL
      AND l."status"::text IN ('OPEN', 'QUALIFIED')
      AND COALESCE(stage."stableKey", '') <> 'active-prospecting.conversation-started'
      AND NOT EXISTS (
        SELECT 1
        FROM "tasks" sla_task
        WHERE sla_task."workspaceId" = l."workspaceId"
          AND sla_task."leadId" = l."id"
          AND sla_task."id" = l."nextActionTaskId"
          AND sla_task."slaCycleId" IS NOT NULL
          AND sla_task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND sla_task."deletedAt" IS NULL
      )
      AND ${leadVisibilitySql(context, scope)}
      ${memberFilter}
    `;
    const order = operationalOrderSql(now);
    const rowsBySection = await Promise.all(
      sectionDefinitions.map((definition) =>
        options.database.$queryRaw<RawQueueRow[]>(Prisma.sql`
          SELECT
            l."id",
            l."fullName",
            l."jobTitle",
            COALESCE(l."latestInterestSummary", l."interestSummary") AS "pain",
            COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") AS "priorityCode",
            latest_score."score",
            COALESCE(latest_score."reason", latest_cycle."priorityName") AS "priorityReason",
            COALESCE(owner_user."displayName", responsible_queue."name") AS "responsibleName",
            CASE WHEN owner."id" IS NULL THEN 'QUEUE' ELSE 'MEMBER' END AS "responsibleType",
            pipeline."name" AS "pipelineName",
            stage."name" AS "stageName",
            stage."position" AS "stagePosition",
            COALESCE(latest_cycle."receivedAt", l."createdAt") AS "receivedAt",
            latest_cycle."firstHumanAttemptAt",
            ${slaSeconds} AS "slaSeconds",
            latest_cycle."healthyMaxSeconds",
            latest_cycle."attentionMaxSeconds",
            l."lastActivityAt",
            latest_activity."subject" AS "lastActivitySubject",
            COALESCE(next_task."id", l."nextActionTaskId")::text AS "nextActionTaskId",
            COALESCE(next_task."dueAt", l."nextActionAt") AS "nextActionAt",
            COALESCE(next_task."title", l."nextActionDescription") AS "nextActionDescription",
            next_task."kind"::text AS "nextActionKind",
            next_task."sourceKey" AS "nextActionSourceKey",
            l."awaitingHumanResponse",
            l."lastInboundResponseAt",
            meeting_today."id"::text AS "meetingTodayId",
            meeting_today."startsAt" AS "meetingTodayStartsAt",
            COUNT(*) OVER()::integer AS "sectionTotal"
          ${joins}
          WHERE ${baseWhere} AND ${bucketSql(definition.key, now)}
          ORDER BY ${order}
          LIMIT ${definition.limit}
        `),
      ),
    );
    const today = workspaceDayRange(workspaceDateAt(now, workspace.timeZone), workspace.timeZone);
    const todayLocal = workspaceDateAt(now, workspace.timeZone);
    const productivityMemberSql = productivityMemberIds.length === 0
      ? Prisma.sql`AND FALSE`
      : Prisma.sql`AND task."assigneeMemberId" IN (${Prisma.join(productivityMemberIds)})`;
    const [
      taskCounts,
      meetingsToday,
      meetingsCompleted,
      effectiveContactFacts,
      qualifications,
      meetingsScheduledFacts,
      proposals,
      salesValue,
      politiciansTouchedRows,
      coldPendingRows,
      coldCadenceRows,
      newlyReleasedRows,
      returnRows,
      prospectingDailyActionRows,
      prospectingSellerConfigs,
      calendarHolidays,
      dailyGoalProfiles,
      prospectingTaskResultCounts,
      dailyMetricFacts,
    ] = await Promise.all([
      options.database.task.groupBy({
        by: ["kind", "status"],
        where: {
          workspaceId: context.workspaceId,
          assigneeMemberId: { in: productivityMemberIds },
          slaCycleId: null,
          lead: {
            currentStage: {
              stableKey: { not: "active-prospecting.conversation-started" },
            },
          },
          kind: { not: "MEETING" },
          deletedAt: null,
          AND: [
            {
              OR: [
                { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: today.end } },
                { status: "COMPLETED", completedAt: { gte: today.start, lt: today.end } },
              ],
            },
            {
              OR: [
                { status: "COMPLETED" },
                { kind: { notIn: ["IMMEDIATE_CALL", "CALL"] } },
                {
                  lead: {
                    contactPreference: { not: "DO_NOT_CONTACT" },
                    OR: [
                      { normalizedPhone: { not: null } },
                      {
                        contact: {
                          points: {
                            some: {
                              type: { in: ["PHONE", "WHATSAPP"] },
                              doNotContact: false,
                              deletedAt: null,
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        _count: { _all: true },
      }),
      options.database.meeting.count({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { ownerMemberId: { in: productivityMemberIds } },
            { lead: { ownerMemberId: { in: productivityMemberIds } } },
          ],
          startsAt: { gte: today.start, lt: today.end },
          status: { not: "CANCELLED" },
          deletedAt: null,
        },
      }),
      options.database.meeting.count({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { ownerMemberId: { in: productivityMemberIds } },
            { lead: { ownerMemberId: { in: productivityMemberIds } } },
          ],
          completedAt: { gte: today.start, lt: today.end },
          status: "COMPLETED",
          deletedAt: null,
        },
      }),
      options.database.commercialMetricFact.groupBy({
        by: ["eventType", "leadId"],
        where: {
          workspaceId: context.workspaceId,
          creditedMemberId: { in: productivityMemberIds },
          occurredAt: { gte: today.start, lt: today.end },
          eventType: { in: ["CALL_CONNECTED", "INBOUND_MESSAGE_RECEIVED"] },
          leadId: { not: null },
        },
        _sum: { quantity: true },
      }),
      options.database.commercialMetricFact.groupBy({
        by: ["leadId"],
        where: {
          workspaceId: context.workspaceId,
          eventType: "LEAD_QUALIFIED",
          occurredAt: { gte: today.start, lt: today.end },
          creditedMemberId: { in: productivityMemberIds },
          leadId: { not: null },
        },
        _sum: { quantity: true },
      }),
      options.database.commercialMetricFact.aggregate({
        where: {
          workspaceId: context.workspaceId,
          occurredAt: { gte: today.start, lt: today.end },
          eventType: "MEETING_SCHEDULED",
          sourceEntityType: "MeetingHistory",
          OR: [
            { bookedByMemberId: { in: productivityMemberIds } },
            { bookedByMemberId: null, creditedMemberId: { in: productivityMemberIds } },
          ],
        },
        _sum: { quantity: true },
      }),
      options.database.commercialMetricFact.aggregate({
        where: {
          workspaceId: context.workspaceId,
          eventType: "PROPOSAL_REACHED",
          sourceEntityType: "Offer",
          occurredAt: { gte: today.start, lt: today.end },
          creditedMemberId: { in: productivityMemberIds },
        },
        _sum: { quantity: true },
      }),
      options.database.commercialMetricFact.aggregate({
        where: {
          workspaceId: context.workspaceId,
          eventType: "SALE_WON",
          occurredAt: { gte: today.start, lt: today.end },
          creditedMemberId: { in: productivityMemberIds },
        },
        _sum: { valueCents: true },
      }),
      options.database.$queryRaw<Array<{ leadId: string }>>(Prisma.sql`
        SELECT DISTINCT task."leadId"
        FROM "tasks" task
        JOIN "prospecting_cadence_steps" step
          ON step."workspaceId" = task."workspaceId" AND step."taskId" = task."id"
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND task."status"::text = 'COMPLETED'
          AND task."completedAt" >= ${today.start}
          AND task."completedAt" < ${today.end}
          AND task."kind"::text IN ('CALL', 'INSTAGRAM_MESSAGE', 'INSTAGRAM_FOLLOW')
          AND task."deletedAt" IS NULL
      `),
      options.database.$queryRaw<Array<{ leadId: string }>>(Prisma.sql`
        SELECT DISTINCT task."leadId"
        FROM "tasks" task
        JOIN "prospecting_cadence_steps" step
          ON step."workspaceId" = task."workspaceId" AND step."taskId" = task."id"
        JOIN "prospecting_cadence_instances" cadence
          ON cadence."workspaceId" = step."workspaceId" AND cadence."id" = step."cadenceInstanceId"
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND task."dueAt" < ${today.end}
          AND cadence."status"::text IN ('PENDING_D1', 'ACTIVE')
          AND task."deletedAt" IS NULL
      `),
      options.database.$queryRaw<Array<{ leadId: string }>>(Prisma.sql`
        SELECT DISTINCT task."leadId"
        FROM "tasks" task
        JOIN "prospecting_cadence_steps" step
          ON step."workspaceId" = task."workspaceId" AND step."taskId" = task."id"
        JOIN "prospecting_cadence_instances" cadence
          ON cadence."workspaceId" = step."workspaceId" AND cadence."id" = step."cadenceInstanceId"
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND task."dueAt" < ${today.end}
          AND cadence."status"::text = 'ACTIVE'
          AND task."deletedAt" IS NULL
      `),
      options.database.$queryRaw<Array<{ leadId: string }>>(Prisma.sql`
        SELECT DISTINCT cadence."leadId"
        FROM "prospecting_cadence_instances" cadence
        WHERE cadence."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberIds.length === 0
            ? Prisma.sql`AND FALSE`
            : Prisma.sql`AND cadence."ownerMemberId" IN (${Prisma.join(productivityMemberIds)})`}
          AND cadence."status"::text = 'PENDING_D1'
          AND cadence."d1Date" = ${todayLocal}::date
      `),
      options.database.$queryRaw<Array<{ leadId: string }>>(Prisma.sql`
        SELECT DISTINCT task."leadId"
        FROM "tasks" task
        JOIN "prospecting_cadence_instances" cadence
          ON cadence."workspaceId" = task."workspaceId" AND cadence."leadId" = task."leadId"
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND task."status"::text IN ('OPEN', 'IN_PROGRESS')
          AND task."kind"::text = 'FOLLOW_UP'
          AND task."dueAt" < ${today.end}
          AND cadence."status"::text = 'MEETING_SCHEDULED'
          AND task."deletedAt" IS NULL
      `),
      options.database.$queryRaw<ProspectingDailyActionRow[]>(Prisma.sql`
        SELECT
          step."stepKey" AS "stepKey",
          step."action"::text AS "action",
          COUNT(*) FILTER (
            WHERE task."status"::text = 'COMPLETED'
              AND task."completedAt" >= ${today.start}
              AND task."completedAt" < ${today.end}
          )::integer AS "completed",
          COUNT(*) FILTER (
            WHERE task."status"::text IN ('OPEN', 'IN_PROGRESS')
              AND task."dueAt" < ${today.end}
              AND cadence."status"::text IN ('PENDING_D1', 'ACTIVE')
          )::integer AS "pending"
        FROM "tasks" task
        JOIN "prospecting_cadence_steps" step
          ON step."workspaceId" = task."workspaceId" AND step."taskId" = task."id"
        JOIN "prospecting_cadence_instances" cadence
          ON cadence."workspaceId" = step."workspaceId" AND cadence."id" = step."cadenceInstanceId"
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND step."executor"::text = 'SELLER'
          AND task."kind"::text IN ('CALL', 'INSTAGRAM_MESSAGE', 'INSTAGRAM_FOLLOW')
          AND task."deletedAt" IS NULL
          AND (
            (
              task."status"::text = 'COMPLETED'
              AND task."completedAt" >= ${today.start}
              AND task."completedAt" < ${today.end}
            )
            OR (
              task."status"::text IN ('OPEN', 'IN_PROGRESS')
              AND task."dueAt" < ${today.end}
              AND cadence."status"::text IN ('PENDING_D1', 'ACTIVE')
            )
          )
        GROUP BY step."stepKey", step."action"

        UNION ALL

        SELECT
          'follow-up' AS "stepKey",
          'FOLLOW_UP' AS "action",
          COUNT(*) FILTER (
            WHERE task."status"::text = 'COMPLETED'
              AND task."completedAt" >= ${today.start}
              AND task."completedAt" < ${today.end}
          )::integer AS "completed",
          COUNT(*) FILTER (
            WHERE task."status"::text IN ('OPEN', 'IN_PROGRESS')
              AND task."dueAt" < ${today.end}
          )::integer AS "pending"
        FROM "tasks" task
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          ${productivityMemberSql}
          AND task."sourceKey" LIKE 'active-prospecting:%'
          AND task."kind"::text = 'FOLLOW_UP'
          AND task."deletedAt" IS NULL
          AND (
            (
              task."status"::text = 'COMPLETED'
              AND task."completedAt" >= ${today.start}
              AND task."completedAt" < ${today.end}
            )
            OR (
              task."status"::text IN ('OPEN', 'IN_PROGRESS')
              AND task."dueAt" < ${today.end}
            )
          )
        HAVING COUNT(*) > 0
      `),
      options.database.prospectingSellerConfig.findMany({
        where: { workspaceId: context.workspaceId, memberId: { in: productivityMemberIds }, active: true },
        select: { memberId: true, dailyCapacity: true },
      }),
      options.database.prospectingCalendarHoliday.findMany({
        where: { workspaceId: context.workspaceId, localDate: new Date(`${todayLocal}T00:00:00.000Z`) },
        select: { localDate: true },
      }),
      options.database.dailyGoalProfile.findMany({
        where: { workspaceId: context.workspaceId, memberId: { in: dailyGoalProfileMemberIds } },
        orderBy: { memberId: "asc" },
      }),
      options.database.commercialMetricFact.groupBy({
        by: ["taskKind", "result"],
        where: {
          workspaceId: context.workspaceId,
          creditedMemberId: { in: productivityMemberIds },
          taskKind: { in: ["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"] },
          eventType: "TASK_COMPLETED",
          sourceEntityType: "Task",
          occurredAt: { gte: today.start, lt: today.end },
        },
        _sum: { quantity: true },
      }),
      options.database.commercialMetricFact.groupBy({
        by: ["eventType", "result", "leadId"],
        where: {
          workspaceId: context.workspaceId,
          creditedMemberId: { in: productivityMemberIds },
          occurredAt: { gte: today.start, lt: today.end },
          eventType: { in: ["CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED", "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED", "EMAIL_SENT"] },
        },
        _sum: { quantity: true },
      }),
    ]);
    const productivityDailyGoalProfiles = dailyGoalProfiles.filter((profile) =>
      productivityMemberIds.includes(profile.memberId),
    );
    const taskCount = (kinds: readonly string[], statuses: readonly string[]) => taskCounts
      .filter((item) => kinds.includes(item.kind) && statuses.includes(item.status))
      .reduce((total, item) => total + item._count._all, 0);
    const openStatuses = ["OPEN", "IN_PROGRESS"];
    const actionableKinds = ["GENERAL", "IMMEDIATE_CALL", "CALL", "MESSAGE", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "EMAIL", "FOLLOW_UP"];
    const tasksDue = taskCount(actionableKinds, openStatuses);
    const prospectingResults = summarizeProspectingTaskResults(prospectingTaskResultCounts.map((row) => ({
      kind: row.taskKind ?? "",
      result: row.result,
      count: row._sum.quantity ?? 0,
    })));
    const metricCount = (eventType: string, results?: readonly string[]) => dailyMetricFacts
      .filter((fact) => fact.eventType === eventType && (!results || (fact.result !== null && results.includes(fact.result))))
      .reduce((total, fact) => total + (fact._sum.quantity ?? 0), 0);
    const calls = metricCount("CALL_ATTEMPTED");
    const messages = metricCount("INSTAGRAM_MESSAGE_SENT");
    const callsUnanswered = metricCount("CALL_UNANSWERED");
    const callsFailed = metricCount("CALL_FAILED");
    const callsUnansweredOther = Math.max(0, callsUnanswered - metricCount("CALL_UNANSWERED", ["NO_ANSWER", "BUSY", "VOICEMAIL"]));
    const callsFailedOther = Math.max(0, callsFailed - metricCount("CALL_FAILED", ["WRONG_NUMBER", "CHANNEL_UNAVAILABLE"]));
    const callsWithoutOutcome = countUnresolvedCallAttempts(dailyMetricFacts.map((fact) => ({
      eventType: fact.eventType, leadId: fact.leadId, quantity: fact._sum.quantity ?? 0,
    })));
    const touchedBalances = new Map<string, number>();
    for (const fact of dailyMetricFacts) {
      if (!fact.leadId || !["CALL_ATTEMPTED", "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED", "EMAIL_SENT"].includes(fact.eventType)) continue;
      const key = `${fact.eventType}:${fact.leadId}`;
      touchedBalances.set(key, (touchedBalances.get(key) ?? 0) + (fact._sum.quantity ?? 0));
    }
    const outreachLeadsTouched = new Set([...touchedBalances].filter(([, balance]) => balance > 0).map(([key]) => key.slice(key.indexOf(":") + 1))).size;
    const effectiveContacts = summarizeEffectiveContacts(effectiveContactFacts.map((fact) => ({
      eventType: fact.eventType, leadId: fact.leadId, quantity: fact._sum.quantity ?? 0,
    }))).total;
    const dailyGoalProgress = buildDailyGoalProgress(
      {
        calls: BigInt(calls),
        messages: BigInt(messages),
        effectiveContacts: BigInt(effectiveContacts),
        qualifications: BigInt(qualifications.filter((row) => (row._sum.quantity ?? 0) > 0).length),
        meetingsScheduled: BigInt(meetingsScheduledFacts._sum.quantity ?? 0),
        proposals: BigInt(proposals._sum.quantity ?? 0),
        salesValueCents: salesValue._sum.valueCents ?? 0n,
      },
      {
        calls: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.callsTarget), 0n),
        messages: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.messagesTarget), 0n),
        effectiveContacts: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.effectiveContactsTarget), 0n),
        qualifications: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.qualificationsTarget), 0n),
        meetingsScheduled: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.meetingsScheduledTarget), 0n),
        proposals: productivityDailyGoalProfiles.reduce((total, item) => total + BigInt(item.proposalsTarget), 0n),
        salesValueCents: productivityDailyGoalProfiles.reduce((total, item) => total + item.salesValueTargetCents, 0n),
      },
    );
    const businessDay = isBusinessDate(todayLocal, new Set(calendarHolidays.map((holiday) => holiday.localDate.toISOString().slice(0, 10))));
    const politiciansTouchedTarget = businessDay
      ? prospectingSellerConfigs.reduce((total, seller) => total + seller.dailyCapacity, 0)
      : 0;
    const dailyQueueLeadIds = new Set(
      [...politiciansTouchedRows, ...coldPendingRows, ...returnRows].map((row) => row.leadId),
    );

    const sections: SdrQueueSection[] = sectionDefinitions.map((definition, index) => {
      const rawRows = rowsBySection[index] ?? [];
      const items: SdrQueueItem[] = rawRows.map((row) => {
        const priorityCode: SdrQueueItem["priorityCode"] =
          row.priorityCode === "P1" || row.priorityCode === "P2" || row.priorityCode === "P3"
            ? row.priorityCode
            : null;
        const itemWithoutRecommendation = {
          id: row.id,
          fullName: row.fullName,
          jobTitle: row.jobTitle,
          pain: row.pain,
          priorityCode,
          score: row.score,
          priorityReason: row.priorityReason,
          responsibleName: row.responsibleName ?? "Responsável não identificado",
          responsibleType: row.responsibleType === "QUEUE" ? "QUEUE" as const : "MEMBER" as const,
          pipelineName: row.pipelineName,
          stageName: row.stageName,
          stagePosition: row.stagePosition,
          receivedAt: row.receivedAt.toISOString(),
          firstHumanAttemptAt: row.firstHumanAttemptAt?.toISOString() ?? null,
          slaSeconds: row.slaSeconds,
          healthyMaxSeconds: row.healthyMaxSeconds,
          attentionMaxSeconds: row.attentionMaxSeconds,
          lastActivityAt: row.lastActivityAt.toISOString(),
          lastActivitySubject: row.lastActivitySubject,
          nextActionTaskId: row.nextActionTaskId,
          nextActionAt: row.nextActionAt?.toISOString() ?? null,
          nextActionDescription: row.nextActionDescription,
          nextActionKind: row.nextActionKind,
          nextActionSourceKey: row.nextActionSourceKey,
          awaitingHumanResponse: row.awaitingHumanResponse,
          lastInboundResponseAt: row.lastInboundResponseAt?.toISOString() ?? null,
          meetingTodayId: row.meetingTodayId,
          meetingTodayStartsAt: row.meetingTodayStartsAt?.toISOString() ?? null,
        };
        return {
          ...itemWithoutRecommendation,
          recommendation: getSdrQueueRecommendation(itemWithoutRecommendation, now),
        };
      });
      return {
        key: definition.key,
        title: definition.title,
        description: definition.description,
        total: rawRows[0]?.sectionTotal ?? 0,
        drilldownHref: drilldownHref(
          definition.key,
          scope.scope === "OWN" ? null : selectedMemberId,
        ),
        items,
      };
    });

    return {
      generatedAt: now.toISOString(),
      timeZone: workspace.timeZone,
      viewer: {
        memberId: context.memberId,
        displayName: context.displayName,
        scope: scope.scope,
      },
      selectedMemberId,
      sdrOptions: members.map((member) => ({
        id: member.id,
        name: member.user.displayName,
        active: member.status === "ACTIVE" && member.user.status === "ACTIVE",
      })),
      dailyGoalMemberOptions: dailyGoalMembers.map((member) => ({
        id: member.id,
        name: member.user.displayName,
      })),
      permissions: { manageDailyGoals: manageDailyGoalsDecision.allowed },
      dailyGoalProfiles: manageDailyGoalsDecision.allowed ? dailyGoalProfiles.map((profile) => ({
        memberId: profile.memberId,
        revision: profile.revision,
        callsTarget: profile.callsTarget,
        messagesTarget: profile.messagesTarget,
        effectiveContactsTarget: profile.effectiveContactsTarget,
        qualificationsTarget: profile.qualificationsTarget,
        meetingsScheduledTarget: profile.meetingsScheduledTarget,
        proposalsTarget: profile.proposalsTarget,
        salesValueTargetCents: profile.salesValueTargetCents.toString(),
      })) : [],
      dailyProduction: {
        politiciansTouched: politiciansTouchedRows.length,
        outreachLeadsTouched,
        politiciansTouchedTarget,
        politiciansTouchedOverCapacity: politiciansTouchedRows.length > politiciansTouchedTarget,
        prospecting: {
          businessDay,
          target: politiciansTouchedTarget,
          worked: politiciansTouchedRows.length,
          pending: coldPendingRows.length,
          returns: returnRows.length,
          cadence: coldCadenceRows.length,
          newlyReleased: newlyReleasedRows.length,
          queueSize: dailyQueueLeadIds.size,
          activityPlan: buildProspectingDailyActionPlan(prospectingDailyActionRows),
        },
        calls,
        callsConnected: metricCount("CALL_CONNECTED"),
        callsUnanswered,
        callsUnansweredOther,
        callsCallbackRequested: metricCount("CALL_CONNECTED", ["CALLBACK_REQUESTED"]),
        callsWhatsappShared: metricCount("CALL_CONNECTED", ["WHATSAPP_SHARED"]),
        callsNoAnswer: metricCount("CALL_UNANSWERED", ["NO_ANSWER"]),
        callsBusy: metricCount("CALL_UNANSWERED", ["BUSY"]),
        callsVoicemail: metricCount("CALL_UNANSWERED", ["VOICEMAIL"]),
        callsWrongNumber: metricCount("CALL_FAILED", ["WRONG_NUMBER"]),
        callsChannelUnavailable: metricCount("CALL_FAILED", ["CHANNEL_UNAVAILABLE"]),
        callsFailed,
        callsFailedOther,
        callsWithoutOutcome,
        callsPending: taskCount(["IMMEDIATE_CALL", "CALL"], openStatuses),
        messages,
        instagramMessagesCompleted: prospectingResults.instagramMessagesCompleted,
        instagramMessagesSent: metricCount("INSTAGRAM_MESSAGE_SENT"),
        instagramMessagesProfileNotFound: prospectingResults.instagramMessagesProfileNotFound,
        instagramMessagesFailed: prospectingResults.instagramMessagesFailed,
        instagramFollowsAttempted: prospectingResults.instagramFollowsAttempted,
        instagramFollowsCompleted: metricCount("INSTAGRAM_FOLLOW_COMPLETED"),
        instagramFollowsAlreadyFollowing: prospectingResults.instagramFollowsAlreadyFollowing,
        instagramFollowsProfileNotFound: prospectingResults.instagramFollowsProfileNotFound,
        instagramFollowsFailed: prospectingResults.instagramFollowsFailed,
        messagesPending: taskCount(["MESSAGE", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"], openStatuses),
        emails: metricCount("EMAIL_SENT"),
        tasksDue,
        overdueFollowUps: sections.find((section) => section.key === "OVERDUE")?.total ?? 0,
        meetingsScheduled: meetingsScheduledFacts._sum.quantity ?? 0,
        meetingsToday,
        meetingsCompleted,
        staleLeads: sections.find((section) => section.key === "STALE_CONTACT")?.total ?? 0,
        dailyGoal: {
          configured: productivityDailyGoalProfiles.length > 0,
          configuredMembers: productivityDailyGoalProfiles.length,
          expectedMembers: productivityMemberIds.length,
          ...dailyGoalProgress,
        },
      },
      sections,
    };
  }

  return Object.freeze({ getScreen });
}

let sdrQueueService: ReturnType<typeof createSdrQueueService> | undefined;

export function getSdrQueueService() {
  sdrQueueService ??= createSdrQueueService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return sdrQueueService;
}
