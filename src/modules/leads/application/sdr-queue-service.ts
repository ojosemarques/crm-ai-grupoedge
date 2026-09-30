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
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
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

function bucketSql(bucket: SdrQueueBucket, now: Date): Prisma.Sql {
  switch (bucket) {
    case "NOW":
      return Prisma.sql`TRUE`;
    case "NEW":
      return Prisma.sql`stage."position" = 0`;
    case "P1":
      return Prisma.sql`COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1'`;
    case "WAITING_CALL":
      return Prisma.sql`EXISTS (
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
      WHEN l."awaitingHumanResponse" THEN 0
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1' THEN 1
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P2' THEN 2
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P3' THEN 3
      WHEN l."nextActionAt" < ${now} THEN 4
      ELSE 5
    END ASC,
    CASE WHEN l."awaitingHumanResponse" THEN l."lastInboundResponseAt" END DESC NULLS LAST,
    CASE WHEN stage."position" = 0 THEN latest_cycle."receivedAt" END ASC NULLS LAST,
    CASE WHEN l."nextActionAt" < ${now} THEN l."nextActionAt" END ASC NULLS LAST,
    l."nextActionAt" ASC NULLS LAST,
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
  return {
    workspaceId,
    deletedAt: null,
    user: { deletedAt: null },
    ...(scope === "OWN" ? { id: memberId } : {}),
    teamMemberships: {
      some: {
        function: "SDR",
        deletedAt: null,
        team: { deletedAt: null },
        ...(scope === "TEAM" ? { teamId: { in: [...teamIds] } } : {}),
      },
    },
  };
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
    const [workspace, members] = await Promise.all([
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
    const productivityMemberIds = selectedMemberId
      ? [selectedMemberId]
      : members.filter((member) => member.status === "ACTIVE" && member.user.status === "ACTIVE").map((member) => member.id);
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
      LEFT JOIN "workspace_members" owner
        ON owner."workspaceId" = l."workspaceId" AND owner."id" = l."ownerMemberId"
      LEFT JOIN "users" owner_user ON owner_user."id" = owner."userId"
      LEFT JOIN "queues" responsible_queue
        ON responsible_queue."workspaceId" = l."workspaceId" AND responsible_queue."id" = l."queueId"
      LEFT JOIN "tasks" next_task
        ON next_task."workspaceId" = l."workspaceId"
        AND next_task."leadId" = l."id"
        AND next_task."id" = l."nextActionTaskId"
        AND next_task."deletedAt" IS NULL
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
      AND ${leadVisibilitySql(context, scope)}
      ${memberFilter}
    `;
    const order = operationalOrderSql(now);
    const [rowsBySection, productivityMembers] = await Promise.all([
      Promise.all(
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
            stage."name" AS "stageName",
            stage."position" AS "stagePosition",
            COALESCE(latest_cycle."receivedAt", l."createdAt") AS "receivedAt",
            latest_cycle."firstHumanAttemptAt",
            ${slaSeconds} AS "slaSeconds",
            latest_cycle."healthyMaxSeconds",
            latest_cycle."attentionMaxSeconds",
            l."lastActivityAt",
            latest_activity."subject" AS "lastActivitySubject",
            l."nextActionTaskId",
            l."nextActionAt",
            l."nextActionDescription",
            next_task."kind"::text AS "nextActionKind",
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
      ),
      options.database.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId, id: { in: productivityMemberIds }, deletedAt: null },
        select: { userId: true },
      }),
    ]);

    const actorIds = (await options.database.actor.findMany({
      where: {
        workspaceId: context.workspaceId,
        type: "HUMAN",
        userId: { in: productivityMembers.map((member) => member.userId) },
      },
      select: { id: true },
    })).map((actor) => actor.id);
    const today = workspaceDayRange(workspaceDateAt(now, workspace.timeZone), workspace.timeZone);
    const [activityCounts, taskCounts, meetingsScheduled, meetingsCompleted] = await Promise.all([
      options.database.activity.groupBy({
        by: ["type"],
        where: {
          workspaceId: context.workspaceId,
          createdByActorId: { in: actorIds },
          occurredAt: { gte: today.start, lt: today.end },
          deletedAt: null,
          type: { in: ["CALL", "CALL_CONNECTED", "CALL_UNANSWERED", "MESSAGE_SENT", "EMAIL"] },
        },
        _count: { _all: true },
      }),
      options.database.task.groupBy({
        by: ["kind", "status"],
        where: {
          workspaceId: context.workspaceId,
          assigneeMemberId: { in: productivityMemberIds },
          dueAt: { gte: today.start, lt: today.end },
          status: { not: "CANCELLED" },
          kind: { not: "MEETING" },
          deletedAt: null,
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
    ]);
    const activityCount = (types: readonly string[]) => activityCounts
      .filter((item) => types.includes(item.type))
      .reduce((total, item) => total + item._count._all, 0);
    const taskCount = (kinds: readonly string[], statuses: readonly string[]) => taskCounts
      .filter((item) => kinds.includes(item.kind) && statuses.includes(item.status))
      .reduce((total, item) => total + item._count._all, 0);
    const openStatuses = ["OPEN", "IN_PROGRESS"];
    const actionableKinds = ["GENERAL", "IMMEDIATE_CALL", "CALL", "MESSAGE", "EMAIL", "FOLLOW_UP"];
    const tasksDue = taskCount(actionableKinds, openStatuses);
    const completedTasks = taskCount(actionableKinds, ["COMPLETED"]);
    const dailyTarget = tasksDue + completedTasks + meetingsScheduled;
    const dailyCompleted = completedTasks + meetingsCompleted;

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
      dailyProduction: {
        calls: activityCount(["CALL", "CALL_CONNECTED", "CALL_UNANSWERED"]),
        callsPending: taskCount(["IMMEDIATE_CALL", "CALL"], openStatuses),
        messages: activityCount(["MESSAGE_SENT"]),
        messagesPending: taskCount(["MESSAGE"], openStatuses),
        emails: activityCount(["EMAIL"]),
        tasksDue,
        overdueFollowUps: sections.find((section) => section.key === "OVERDUE")?.total ?? 0,
        meetingsScheduled,
        meetingsCompleted,
        staleLeads: sections.find((section) => section.key === "STALE_CONTACT")?.total ?? 0,
        dailyGoal: {
          completed: dailyCompleted,
          target: dailyTarget,
          remaining: Math.max(0, dailyTarget - dailyCompleted),
          progressPercent: dailyTarget === 0 ? 0 : Math.min(100, Math.round((dailyCompleted / dailyTarget) * 100)),
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
