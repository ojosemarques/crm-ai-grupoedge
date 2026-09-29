import type {
  PermissionScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  type AverageMoneyMetric,
  type MetricsFilters,
  type MetricsOverview,
  type MetricsQuery,
  metricsPriorityCodes,
  type StageDurationMetric,
} from "@/modules/metrics/domain/metrics-contracts";
import {
  countMetric,
  durationStatistics,
  rateMetric,
  slaStatistics,
} from "@/modules/metrics/domain/metric-math";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
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

type MetricsServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const uuidListSchema = z.array(z.string().uuid()).max(100).default([]);
const filtersSchema = z.object({
  sdrMemberIds: uuidListSchema,
  closerMemberIds: uuidListSchema,
  teamIds: uuidListSchema,
  sourceIds: uuidListSchema,
  campaignIds: uuidListSchema,
  creativeIds: uuidListSchema,
  priorityCodes: z.array(z.enum(metricsPriorityCodes)).max(3).default([]),
  productIds: uuidListSchema,
}).strict();
const emptyFilters = {
  sdrMemberIds: [],
  closerMemberIds: [],
  teamIds: [],
  sourceIds: [],
  campaignIds: [],
  creativeIds: [],
  priorityCodes: [],
  productIds: [],
};
const querySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  filters: filtersSchema.optional().default(emptyFilters),
}).strict();

function invalidInput(value: z.ZodError | string): never {
  throw new ApplicationError(
    typeof value === "string"
      ? value
      : value.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function uniqueSorted<const T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

export function parseMetricsQuery(input: unknown): MetricsQuery {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) invalidInput(parsed.error);
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (from >= to) invalidInput("O início do período deve ser anterior ao fim.");
  return Object.freeze({
    from: from.toISOString(),
    to: to.toISOString(),
    filters: Object.freeze({
      sdrMemberIds: uniqueSorted(parsed.data.filters.sdrMemberIds),
      closerMemberIds: uniqueSorted(parsed.data.filters.closerMemberIds),
      teamIds: uniqueSorted(parsed.data.filters.teamIds),
      sourceIds: uniqueSorted(parsed.data.filters.sourceIds),
      campaignIds: uniqueSorted(parsed.data.filters.campaignIds),
      creativeIds: uniqueSorted(parsed.data.filters.creativeIds),
      priorityCodes: uniqueSorted(parsed.data.filters.priorityCodes),
      productIds: uniqueSorted(parsed.data.filters.productIds),
    }),
  });
}

async function resolveMetricsScope(
  database: PrismaClient,
  authorization: AuthorizationPort,
  context: AuthenticatedContext,
): Promise<Readonly<{ scope: PermissionScope; teamIds: readonly string[] }>> {
  const resource: ResourceScope = {
    workspaceId: context.workspaceId,
    resourceType: "Metrics",
    memberId: context.memberId,
  };
  const decision = await authorization.authorize(
    context,
    PermissionKeys.METRICS_READ,
    resource,
  );
  if (!decision.allowed) {
    await authorization.assertAuthorized(
      context,
      PermissionKeys.METRICS_READ,
      resource,
    );
    throw new Error("Unreachable authorization state.");
  }
  const memberships = await database.teamMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      workspaceMemberId: context.memberId,
      deletedAt: null,
      team: { deletedAt: null },
    },
    select: { teamId: true },
  });
  return Object.freeze({
    scope: decision.scope,
    teamIds: uniqueSorted(memberships.map((item) => item.teamId)),
  });
}

function relationalVisibility(
  context: AuthenticatedContext,
  scope: PermissionScope,
  teamIds: readonly string[],
  scopedMemberIds: readonly string[],
): Prisma.LeadWhereInput {
  if (scope === "WORKSPACE") return {};
  const memberIds = uniqueSorted([context.memberId, ...scopedMemberIds]);
  const relations: Prisma.LeadWhereInput[] = [
    { ownerMemberId: { in: memberIds } },
    { slaCycles: { some: { assignedMemberId: { in: memberIds } } } },
    { meetings: { some: { ownerMemberId: { in: memberIds } } } },
    { meetingHistory: { some: { ownerMemberId: { in: memberIds } } } },
    { opportunities: { some: { ownerMemberId: { in: memberIds } } } },
    { opportunityOutcomeSnapshots: { some: { ownerMemberId: { in: memberIds } } } },
  ];
  if (scope === "TEAM" && teamIds.length > 0) {
    relations.push(
      { queue: { teamId: { in: [...teamIds] } } },
      { routingQueue: { teamId: { in: [...teamIds] } } },
    );
  }
  return { OR: relations };
}

function dimensionFilters(
  filters: MetricsFilters,
  filteredTeamMemberIds: readonly string[],
): Prisma.LeadWhereInput[] {
  const clauses: Prisma.LeadWhereInput[] = [];
  if (filters.sourceIds.length > 0) clauses.push({ sourceId: { in: [...filters.sourceIds] } });
  if (filters.campaignIds.length > 0) clauses.push({ campaignId: { in: [...filters.campaignIds] } });
  if (filters.creativeIds.length > 0) clauses.push({ creativeId: { in: [...filters.creativeIds] } });
  if (filters.sdrMemberIds.length > 0) {
    clauses.push({ slaCycles: { some: { assignedMemberId: { in: [...filters.sdrMemberIds] } } } });
  }
  if (filters.closerMemberIds.length > 0) {
    clauses.push({
      OR: [
        { meetings: { some: { ownerMemberId: { in: [...filters.closerMemberIds] } } } },
        { meetingHistory: { some: { ownerMemberId: { in: [...filters.closerMemberIds] } } } },
        { opportunities: { some: { ownerMemberId: { in: [...filters.closerMemberIds] } } } },
        { opportunityOutcomeSnapshots: { some: { ownerMemberId: { in: [...filters.closerMemberIds] } } } },
      ],
    });
  }
  if (filters.productIds.length > 0) {
    clauses.push({
      OR: [
        { opportunities: { some: { productId: { in: [...filters.productIds] } } } },
        { opportunityOutcomeSnapshots: { some: { productId: { in: [...filters.productIds] } } } },
      ],
    });
  }
  if (filters.teamIds.length > 0) {
    clauses.push({
      OR: [
        { ownerMemberId: { in: [...filteredTeamMemberIds] } },
        { queue: { teamId: { in: [...filters.teamIds] } } },
        { routingQueue: { teamId: { in: [...filters.teamIds] } } },
        { meetings: { some: { ownerMemberId: { in: [...filteredTeamMemberIds] } } } },
        { meetingHistory: { some: { ownerMemberId: { in: [...filteredTeamMemberIds] } } } },
        { opportunities: { some: { ownerMemberId: { in: [...filteredTeamMemberIds] } } } },
        { opportunityOutcomeSnapshots: { some: { ownerMemberId: { in: [...filteredTeamMemberIds] } } } },
      ],
    });
  }
  return clauses;
}

function durationSeconds(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1_000));
}

function stageMetrics(
  intervals: ReadonlyArray<{
    pipelineId: string;
    stageId: string;
    enteredAt: Date;
    exitedAt: Date | null;
    leadId: string | null;
    pipeline: { name: string };
    stage: { name: string };
  }>,
  from: Date,
  to: Date,
): StageDurationMetric[] {
  const grouped = new Map<string, {
    pipelineId: string;
    pipelineName: string;
    entityType: "LEAD" | "OPPORTUNITY";
    stageId: string;
    stageName: string;
    values: number[];
  }>();
  for (const interval of intervals) {
    const startedAt = interval.enteredAt > from ? interval.enteredAt : from;
    const rawEnd = interval.exitedAt ?? to;
    const endedAt = rawEnd < to ? rawEnd : to;
    if (endedAt <= startedAt) continue;
    const entityType = interval.leadId ? "LEAD" as const : "OPPORTUNITY" as const;
    const key = `${interval.pipelineId}:${interval.stageId}:${entityType}`;
    const current = grouped.get(key) ?? {
      pipelineId: interval.pipelineId,
      pipelineName: interval.pipeline.name,
      entityType,
      stageId: interval.stageId,
      stageName: interval.stage.name,
      values: [],
    };
    current.values.push(durationSeconds(startedAt, endedAt));
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((left, right) => left.pipelineName.localeCompare(right.pipelineName, "pt-BR")
      || left.stageName.localeCompare(right.stageName, "pt-BR")
      || left.entityType.localeCompare(right.entityType))
    .map(({ values, ...group }) => Object.freeze({
      ...group,
      statistics: durationStatistics(values),
    }));
}

function averageMoney(total: bigint, denominator: number): AverageMoneyMetric {
  if (denominator === 0) {
    return Object.freeze({ cents: null, numeratorCents: total.toString(), denominator, currency: "BRL" });
  }
  const divisor = BigInt(denominator);
  return Object.freeze({
    cents: ((total + divisor / 2n) / divisor).toString(),
    numeratorCents: total.toString(),
    denominator,
    currency: "BRL",
  });
}

export function createMetricsService(options: MetricsServiceOptions) {
  async function getOverview(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<MetricsOverview> {
    const query = parseMetricsQuery(input);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const scope = await resolveMetricsScope(
      options.database,
      options.authorization,
      context,
    );
    const workspace = await options.database.workspace.findFirst({
      where: { id: context.workspaceId, status: "ACTIVE", deletedAt: null },
      select: {
        timeZone: true,
        leadStagnationDays: true,
        leadWithoutActivityDays: true,
      },
    });
    if (!workspace) {
      throw new ApplicationError("Workspace não encontrado.", {
        code: "NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }

    const allTeamIds = uniqueSorted([...scope.teamIds, ...query.filters.teamIds]);
    const teamMembers = allTeamIds.length === 0
      ? []
      : await options.database.teamMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            teamId: { in: allTeamIds },
            deletedAt: null,
          },
          select: { teamId: true, workspaceMemberId: true },
        });
    const scopedMemberIds = uniqueSorted(teamMembers
      .filter((membership) => scope.teamIds.includes(membership.teamId))
      .map((membership) => membership.workspaceMemberId));
    const filteredTeamMemberIds = uniqueSorted(teamMembers
      .filter((membership) => query.filters.teamIds.includes(membership.teamId))
      .map((membership) => membership.workspaceMemberId));

    const leads = await options.database.lead.findMany({
      where: {
        workspaceId: context.workspaceId,
        createdAt: { lt: to },
        OR: [{ deletedAt: null }, { deletedAt: { gte: from } }],
        AND: [
          relationalVisibility(
            context,
            scope.scope,
            scope.teamIds,
            scope.scope === "TEAM" ? scopedMemberIds : [],
          ),
          ...dimensionFilters(query.filters, filteredTeamMemberIds),
        ],
      },
      select: {
        id: true,
        deletedAt: true,
        scores: {
          where: { calculatedAt: { lt: to }, currentRevision: { not: null } },
          orderBy: [{ currentRevision: "desc" }, { calculatedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { priorityBandCode: true },
        },
        slaCycles: {
          where: { receivedAt: { lt: to } },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { priorityBand: { select: { code: true } } },
        },
      },
    });
    const priorityFilteredLeads = query.filters.priorityCodes.length === 0
      ? leads
      : leads.filter((lead) => {
          const priority = lead.scores[0]?.priorityBandCode ?? lead.slaCycles[0]?.priorityBand.code;
          return priority ? query.filters.priorityCodes.includes(priority) : false;
        });
    const leadIds = priorityFilteredLeads.map((lead) => lead.id);

    const emptyIn = leadIds.length === 0 ? ["00000000-0000-0000-0000-000000000000"] : leadIds;
    const [
      createdSubmissions,
      slaCycles,
      qualificationHistory,
      intervalHistory,
      activeStageHistory,
      meetingHistory,
      outcomeSnapshots,
      opportunitiesCreated,
      proposalHistory,
      disqualificationHistory,
      humanActivities,
      tasks,
      settingsVersion,
    ] = await Promise.all([
      options.database.leadFormSubmission.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          intakeOutcome: "CREATED",
          submittedAt: { gte: from, lt: to },
          ...(query.filters.sdrMemberIds.length > 0
            ? { slaCycle: { assignedMemberId: { in: [...query.filters.sdrMemberIds] } } }
            : {}),
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          leadId: true,
          submittedAt: true,
          slaCycle: {
            select: {
              id: true,
              firstHumanAttemptAt: true,
              firstConnectedAt: true,
            },
          },
        },
      }),
      options.database.leadSlaCycle.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          receivedAt: { gte: from, lt: to },
          ...(query.filters.sdrMemberIds.length > 0
            ? { assignedMemberId: { in: [...query.filters.sdrMemberIds] } }
            : {}),
        },
        select: {
          id: true,
          receivedAt: true,
          leadId: true,
          automaticAcknowledgedAt: true,
          firstHumanAttemptAt: true,
          firstHumanAttemptSeconds: true,
          firstConnectedAt: true,
          firstResponseTimeSeconds: true,
        },
      }),
      options.database.stageHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          enteredAt: { lt: to },
          stage: { leadStageCode: "QUALIFIED" },
        },
        orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
        select: { id: true, leadId: true, enteredAt: true },
      }),
      options.database.stageHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          enteredAt: { lt: to },
          OR: [
            { leadId: { in: emptyIn } },
            { opportunity: { leadId: { in: emptyIn } } },
          ],
          AND: [
            { OR: [{ exitedAt: null }, { exitedAt: { gt: from } }] },
          ],
        },
        select: {
          pipelineId: true,
          stageId: true,
          leadId: true,
          enteredAt: true,
          exitedAt: true,
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          opportunity: { select: { ownerMemberId: true, productId: true } },
        },
      }),
      options.database.stageHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          enteredAt: { lt: to },
          OR: [{ exitedAt: null }, { exitedAt: { gte: to } }],
          stage: {
            leadStageCode: {
              in: [
                "NEW",
                "TRYING_CONTACT",
                "CONNECTED",
                "IN_QUALIFICATION",
                "QUALIFIED",
                "MEETING_SCHEDULED",
                "NURTURING",
              ],
            },
          },
        },
        select: {
          pipelineId: true,
          stageId: true,
          leadId: true,
          enteredAt: true,
          exitedAt: true,
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
        },
      }),
      options.database.meetingHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          occurredAt: { lt: to },
          ...(query.filters.closerMemberIds.length > 0
            ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
            : {}),
        },
        orderBy: [{ meetingRevision: "asc" }, { id: "asc" }],
        select: {
          meetingId: true,
          leadId: true,
          meetingRevision: true,
          action: true,
          newStatus: true,
          newStartsAt: true,
          occurredAt: true,
        },
      }),
      options.database.opportunityOutcomeSnapshot.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          occurredAt: { lt: to },
          ...(query.filters.closerMemberIds.length > 0
            ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
            : {}),
          ...(query.filters.productIds.length > 0
            ? { productId: { in: [...query.filters.productIds] } }
            : {}),
        },
        select: {
          id: true,
          opportunityId: true,
          leadId: true,
          status: true,
          amountCents: true,
          mrrCents: true,
          tcvCents: true,
          occurredAt: true,
          stageHistory: { select: { exitedAt: true } },
        },
      }),
      options.database.opportunity.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          createdAt: { gte: from, lt: to },
          OR: [{ deletedAt: null }, { deletedAt: { gte: from } }],
          ...(query.filters.closerMemberIds.length > 0
            ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
            : {}),
          ...(query.filters.productIds.length > 0
            ? { productId: { in: [...query.filters.productIds] } }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, leadId: true, createdAt: true },
      }),
      options.database.stageHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          opportunity: {
            leadId: { in: emptyIn },
            ...(query.filters.closerMemberIds.length > 0
              ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
              : {}),
            ...(query.filters.productIds.length > 0
              ? { productId: { in: [...query.filters.productIds] } }
              : {}),
          },
          stage: { opportunityStageCode: "PROPOSAL" },
          enteredAt: { gte: from, lt: to },
        },
        orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          opportunityId: true,
          enteredAt: true,
          opportunity: { select: { leadId: true } },
        },
      }),
      options.database.stageHistory.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          stage: { leadStageCode: "DISQUALIFIED" },
          enteredAt: { gte: from, lt: to },
          OR: [{ exitedAt: null }, { exitedAt: { gte: to } }],
        },
        orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
        select: { id: true, leadId: true, enteredAt: true },
      }),
      options.database.activity.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          occurredAt: { lt: to },
          deletedAt: null,
          createdBy: { type: "HUMAN" },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { leadId: true, occurredAt: true },
      }),
      options.database.task.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: { in: emptyIn },
          createdAt: { lt: to },
        },
        select: {
          leadId: true,
          status: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      }),
      options.database.commercialSettingsVersion.findFirst({
        where: { workspaceId: context.workspaceId, createdAt: { lt: to } },
        orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
        select: { leadStagnationDays: true, leadWithoutActivityDays: true },
      }),
    ]);

    const cohort = new Set(createdSubmissions.flatMap((submission) => submission.leadId ? [submission.leadId] : []));
    const attempted = new Set(createdSubmissions.flatMap((submission) =>
      submission.leadId && submission.slaCycle?.firstHumanAttemptAt && submission.slaCycle.firstHumanAttemptAt < to
        ? [submission.leadId]
        : []));
    const contacted = new Set(createdSubmissions.flatMap((submission) =>
      submission.leadId && submission.slaCycle?.firstConnectedAt && submission.slaCycle.firstConnectedAt < to
        ? [submission.leadId]
        : []));
    const qualified = new Set(qualificationHistory.flatMap((history) => history.leadId ? [history.leadId] : []));
    const scheduled = new Set(meetingHistory
      .filter((history) => history.action === "SCHEDULED" || history.action === "RESCHEDULED")
      .map((history) => history.leadId));

    const latestMeetings = new Map<string, (typeof meetingHistory)[number]>();
    for (const history of meetingHistory) {
      const previous = latestMeetings.get(history.meetingId);
      if (!previous || previous.meetingRevision <= history.meetingRevision) {
        latestMeetings.set(history.meetingId, history);
      }
    }
    const meetingsInPeriod = [...latestMeetings.values()].filter((meeting) =>
      meeting.newStartsAt >= from && meeting.newStartsAt < to);
    const heldMeetings = meetingsInPeriod.filter((meeting) => meeting.newStatus === "COMPLETED");
    const noShowMeetings = meetingsInPeriod.filter((meeting) => meeting.newStatus === "NO_SHOW");
    const decidedMeetings = heldMeetings.length + noShowMeetings.length;
    const heldLeadIds = new Set(heldMeetings.map((meeting) => meeting.leadId));

    const activeWonSnapshots = outcomeSnapshots.filter((snapshot) =>
      snapshot.status === "WON"
      && (snapshot.stageHistory.exitedAt === null || snapshot.stageHistory.exitedAt >= to));
    const activeLostSnapshots = outcomeSnapshots.filter((snapshot) =>
      snapshot.status === "LOST"
      && (snapshot.stageHistory.exitedAt === null || snapshot.stageHistory.exitedAt >= to));
    const wonLeadIds = new Set(activeWonSnapshots.map((snapshot) => snapshot.leadId));
    const periodWins = activeWonSnapshots.filter((snapshot) => snapshot.occurredAt >= from);
    const periodLosses = activeLostSnapshots.filter((snapshot) => snapshot.occurredAt >= from);
    const revenueCents = periodWins.reduce((sum, snapshot) => sum + snapshot.amountCents, 0n);
    const mrrCents = periodWins.reduce((sum, snapshot) => sum + snapshot.mrrCents, 0n);
    const tcvCents = periodWins.reduce((sum, snapshot) => sum + snapshot.tcvCents, 0n);

    const filteredIntervals = intervalHistory.filter((history) => {
      if (!history.opportunity) return true;
      if (query.filters.closerMemberIds.length > 0
        && !query.filters.closerMemberIds.includes(history.opportunity.ownerMemberId)) return false;
      if (query.filters.productIds.length > 0
        && (!history.opportunity.productId || !query.filters.productIds.includes(history.opportunity.productId))) return false;
      return true;
    });
    const stageTime = stageMetrics(filteredIntervals, from, to);

    const leadsExistingAtCut = new Set(priorityFilteredLeads
      .filter((lead) => lead.deletedAt === null || lead.deletedAt >= to)
      .map((lead) => lead.id));
    const openLeadStages = activeStageHistory.filter((history) =>
      history.leadId && leadsExistingAtCut.has(history.leadId));
    const aging = stageMetrics(openLeadStages, new Date(0), to);
    const agingValues = openLeadStages.map((history) => durationSeconds(history.enteredAt, to));
    const settings = settingsVersion ?? workspace;
    const stagnationCut = new Date(to.getTime() - settings.leadStagnationDays * 86_400_000);
    const activityCut = new Date(to.getTime() - settings.leadWithoutActivityDays * 86_400_000);
    const stalledIds = new Set(openLeadStages
      .filter((history) => history.enteredAt <= stagnationCut)
      .flatMap((history) => history.leadId ? [history.leadId] : []));
    const latestHumanActivity = new Map<string, Date>();
    for (const activity of humanActivities) {
      if (!latestHumanActivity.has(activity.leadId)) latestHumanActivity.set(activity.leadId, activity.occurredAt);
    }
    const openLeadIds = new Set(openLeadStages.flatMap((history) => history.leadId ? [history.leadId] : []));
    const noActivityIds = new Set([...openLeadIds].filter((leadId) => {
      const latest = latestHumanActivity.get(leadId);
      return !latest || latest < activityCut;
    }));
    const activeTaskLeadIds = new Set(tasks.filter((task) => {
      if (!openLeadIds.has(task.leadId)) return false;
      if (task.deletedAt && task.deletedAt < to) return false;
      if (task.completedAt && task.completedAt < to) return false;
      if (task.status === "CANCELLED" && task.updatedAt < to) return false;
      return task.createdAt < to;
    }).map((task) => task.leadId));
    const noNextActionIds = new Set([...openLeadIds].filter((leadId) => !activeTaskLeadIds.has(leadId)));

    const automaticSeconds = slaCycles.map((cycle) =>
      durationSeconds(cycle.receivedAt, cycle.automaticAcknowledgedAt));
    const humanSeconds = slaCycles.map((cycle) => cycle.firstHumanAttemptSeconds
      ?? (cycle.firstHumanAttemptAt ? durationSeconds(cycle.receivedAt, cycle.firstHumanAttemptAt) : null));
    const intersectCount = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
      [...left].filter((id) => right.has(id)).length;
    const qualifiedCohort = new Set([...cohort].filter((id) => qualified.has(id)));
    const contactedCohort = new Set([...cohort].filter((id) => contacted.has(id)));
    const heldToWon = [...heldLeadIds].filter((id) => wonLeadIds.has(id)).length;
    const cohortToWon = [...cohort].filter((id) => wonLeadIds.has(id)).length;
    const firstQualificationByLead = new Map<string, (typeof qualificationHistory)[number]>();
    for (const history of qualificationHistory) {
      if (!history.leadId || !qualifiedCohort.has(history.leadId)) continue;
      const current = firstQualificationByLead.get(history.leadId);
      if (!current || history.enteredAt < current.enteredAt) {
        firstQualificationByLead.set(history.leadId, history);
      }
    }
    const firstScheduleByLead = new Map<string, (typeof meetingHistory)[number]>();
    for (const history of meetingHistory) {
      if (!(history.action === "SCHEDULED" || history.action === "RESCHEDULED")
        || !qualifiedCohort.has(history.leadId)) continue;
      const current = firstScheduleByLead.get(history.leadId);
      if (!current || history.occurredAt < current.occurredAt) {
        firstScheduleByLead.set(history.leadId, history);
      }
    }
    const firstProposalByOpportunity = new Map<string, (typeof proposalHistory)[number]>();
    for (const history of proposalHistory) {
      if (!history.opportunityId) continue;
      if (!firstProposalByOpportunity.has(history.opportunityId)) {
        firstProposalByOpportunity.set(history.opportunityId, history);
      }
    }
    const firstDisqualificationByLead = new Map<string, (typeof disqualificationHistory)[number]>();
    for (const history of disqualificationHistory) {
      if (!history.leadId || firstDisqualificationByLead.has(history.leadId)) continue;
      firstDisqualificationByLead.set(history.leadId, history);
    }

    return Object.freeze({
      period: Object.freeze({
        from: query.from,
        to: query.to,
        interval: "HALF_OPEN" as const,
        timeZone: workspace.timeZone,
      }),
      filters: query.filters,
      scope: scope.scope,
      generatedAt: options.now().toISOString(),
      leadsReceived: countMetric(cohort.size),
      attemptRate: rateMetric(attempted.size, cohort.size),
      contactRate: rateMetric(contacted.size, attempted.size),
      qualificationOverContact: rateMetric(intersectCount(contactedCohort, qualified), contactedCohort.size),
      totalQualificationRate: rateMetric(qualifiedCohort.size, cohort.size),
      schedulingRate: rateMetric(intersectCount(qualifiedCohort, scheduled), qualifiedCohort.size),
      showRate: rateMetric(heldMeetings.length, decidedMeetings),
      noShowRate: rateMetric(noShowMeetings.length, decidedMeetings),
      meetingToSaleRate: rateMetric(heldToWon, heldLeadIds.size),
      leadToSaleRate: rateMetric(cohortToWon, cohort.size),
      automaticSla: slaStatistics(automaticSeconds),
      humanSla: slaStatistics(humanSeconds),
      stageTime,
      aging: Object.freeze({ overall: durationStatistics(agingValues), byStage: aging }),
      revenue: Object.freeze({ cents: revenueCents.toString(), numerator: periodWins.length, denominator: null, currency: "BRL" as const }),
      mrr: Object.freeze({ cents: mrrCents.toString(), numerator: periodWins.length, denominator: null, currency: "BRL" as const }),
      tcv: Object.freeze({ cents: tcvCents.toString(), numerator: periodWins.length, denominator: null, currency: "BRL" as const }),
      averageTicket: averageMoney(revenueCents, periodWins.length),
      backlog: countMetric(openLeadIds.size),
      stalledLeads: countMetric(stalledIds.size),
      leadsWithoutActivity: countMetric(noActivityIds.size),
      leadsWithoutNextAction: countMetric(noNextActionIds.size),
      evidence: Object.freeze({
        universeLeadIds: Object.freeze([...leadIds].sort()),
        leadsReceivedLeadIds: Object.freeze([...cohort].sort()),
        leadReceipts: Object.freeze(createdSubmissions.flatMap((submission) => submission.leadId
          ? [Object.freeze({
              submissionId: submission.id,
              leadId: submission.leadId,
              occurredAt: submission.submittedAt.toISOString(),
            })]
          : [])),
        attemptedLeadIds: Object.freeze([...attempted].sort()),
        firstAttempts: Object.freeze(createdSubmissions.flatMap((submission) =>
          submission.leadId && submission.slaCycle?.firstHumanAttemptAt
            && submission.slaCycle.firstHumanAttemptAt < to
            ? [Object.freeze({
                cycleId: submission.slaCycle.id,
                leadId: submission.leadId,
                occurredAt: submission.slaCycle.firstHumanAttemptAt.toISOString(),
              })]
            : [])),
        contactedLeadIds: Object.freeze([...contacted].sort()),
        firstConnections: Object.freeze(createdSubmissions.flatMap((submission) =>
          submission.leadId && submission.slaCycle?.firstConnectedAt
            && submission.slaCycle.firstConnectedAt < to
            ? [Object.freeze({
                cycleId: submission.slaCycle.id,
                leadId: submission.leadId,
                occurredAt: submission.slaCycle.firstConnectedAt.toISOString(),
              })]
            : [])),
        qualifiedLeadIds: Object.freeze([...qualifiedCohort].sort()),
        qualifications: Object.freeze([...firstQualificationByLead.values()].map((history) => Object.freeze({
          historyId: history.id,
          leadId: history.leadId!,
          occurredAt: history.enteredAt.toISOString(),
        }))),
        scheduledLeadIds: Object.freeze([...qualifiedCohort]
          .filter((leadId) => scheduled.has(leadId))
          .sort()),
        scheduledMeetings: Object.freeze([...firstScheduleByLead.values()].map((history) => Object.freeze({
          meetingId: history.meetingId,
          leadId: history.leadId,
          occurredAt: history.occurredAt.toISOString(),
        }))),
        heldMeetings: Object.freeze(heldMeetings
          .map((meeting) => Object.freeze({
            meetingId: meeting.meetingId,
            leadId: meeting.leadId,
            occurredAt: meeting.newStartsAt.toISOString(),
          }))
          .sort((left, right) => left.meetingId.localeCompare(right.meetingId))),
        noShowMeetings: Object.freeze(noShowMeetings
          .map((meeting) => Object.freeze({
            meetingId: meeting.meetingId,
            leadId: meeting.leadId,
            occurredAt: meeting.newStartsAt.toISOString(),
          }))
          .sort((left, right) => left.meetingId.localeCompare(right.meetingId))),
        opportunitiesCreated: Object.freeze(opportunitiesCreated.map((opportunity) => Object.freeze({
          opportunityId: opportunity.id,
          leadId: opportunity.leadId,
          occurredAt: opportunity.createdAt.toISOString(),
        }))),
        proposals: Object.freeze([...firstProposalByOpportunity.values()].map((history) => Object.freeze({
          historyId: history.id,
          opportunityId: history.opportunityId!,
          leadId: history.opportunity!.leadId,
          occurredAt: history.enteredAt.toISOString(),
        }))),
        periodWins: Object.freeze(periodWins
          .map((snapshot) => Object.freeze({
            snapshotId: snapshot.id,
            opportunityId: snapshot.opportunityId,
            leadId: snapshot.leadId,
            occurredAt: snapshot.occurredAt.toISOString(),
            amountCents: snapshot.amountCents.toString(),
            mrrCents: snapshot.mrrCents.toString(),
            tcvCents: snapshot.tcvCents.toString(),
          }))
          .sort((left, right) => left.snapshotId.localeCompare(right.snapshotId))),
        periodLosses: Object.freeze(periodLosses.map((snapshot) => Object.freeze({
          snapshotId: snapshot.id,
          opportunityId: snapshot.opportunityId,
          leadId: snapshot.leadId,
          occurredAt: snapshot.occurredAt.toISOString(),
        })).sort((left, right) => left.snapshotId.localeCompare(right.snapshotId))),
        disqualifications: Object.freeze([...firstDisqualificationByLead.values()].flatMap((history) => history.leadId
          ? [Object.freeze({
              historyId: history.id,
              leadId: history.leadId,
              occurredAt: history.enteredAt.toISOString(),
            })]
          : [])),
        wonLeadIdsAtCut: Object.freeze([...wonLeadIds].sort()),
        slaCycles: Object.freeze(slaCycles
          .map((cycle) => Object.freeze({
            cycleId: cycle.id,
            leadId: cycle.leadId,
            receivedAt: cycle.receivedAt.toISOString(),
            automaticSeconds: durationSeconds(cycle.receivedAt, cycle.automaticAcknowledgedAt),
            humanSeconds: cycle.firstHumanAttemptSeconds
              ?? (cycle.firstHumanAttemptAt ? durationSeconds(cycle.receivedAt, cycle.firstHumanAttemptAt) : null),
          }))
          .sort((left, right) => left.cycleId.localeCompare(right.cycleId))),
        openLeadIds: Object.freeze([...openLeadIds].sort()),
        stalledLeadIds: Object.freeze([...stalledIds].sort()),
        leadsWithoutActivityIds: Object.freeze([...noActivityIds].sort()),
        leadsWithoutNextActionIds: Object.freeze([...noNextActionIds].sort()),
      }),
    });
  }

  return Object.freeze({ getOverview });
}

let metricsService: ReturnType<typeof createMetricsService> | undefined;

export function getMetricsService(): ReturnType<typeof createMetricsService> {
  metricsService ??= createMetricsService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return metricsService;
}
