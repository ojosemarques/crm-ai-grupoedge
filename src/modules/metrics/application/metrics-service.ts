import type {
  CommercialMetricEventType,
  PermissionScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  type AverageMoneyMetric,
  type CanonicalMetricValue,
  type IntegratedActivityFact,
  type IntegratedMetricsOverview,
  type MetricsFilters,
  type MetricsOverview,
  type MetricsQuery,
  metricsPriorityCodes,
  type StageDurationMetric,
} from "@/modules/metrics/domain/metrics-contracts";
import { INTEGRATED_METRIC_REGISTRY_VERSION, integratedMetricRegistry } from "@/modules/metrics/domain/integrated-metric-registry";
import { commercialMetricQuality } from "@/modules/metrics/domain/commercial-metric-quality";
import { summarizeLeadCohortRate } from "@/modules/metrics/domain/metric-cohort";
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
  pipelineIds: uuidListSchema,
  stageIds: uuidListSchema,
  channels: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  municipality: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  stateCodes: z.array(z.string().trim().length(2).transform((value) => value.toUpperCase())).max(27).default([]),
  politicalRoles: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  cadenceStepKeys: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  executionModes: z.array(z.enum(["MANUAL", "AUTOMATION", "SYSTEM"])).max(3).default([]),
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
  pipelineIds: [],
  stageIds: [],
  channels: [],
  municipality: [],
  stateCodes: [],
  politicalRoles: [],
  cadenceStepKeys: [],
  executionModes: [],
};
const querySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  filters: filtersSchema.optional().default(emptyFilters),
}).strict();
const integratedDrilldownSchema = z.object({
  metricId: z.string().trim().min(1).max(120),
  query: querySchema,
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
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
      pipelineIds: uniqueSorted(parsed.data.filters.pipelineIds),
      stageIds: uniqueSorted(parsed.data.filters.stageIds),
      channels: uniqueSorted(parsed.data.filters.channels),
      municipality: uniqueSorted(parsed.data.filters.municipality),
      stateCodes: uniqueSorted(parsed.data.filters.stateCodes),
      politicalRoles: uniqueSorted(parsed.data.filters.politicalRoles),
      cadenceStepKeys: uniqueSorted(parsed.data.filters.cadenceStepKeys),
      executionModes: uniqueSorted(parsed.data.filters.executionModes),
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

async function integratedFactWhere(
  database: PrismaClient,
  context: AuthenticatedContext,
  scope: Readonly<{ scope: PermissionScope; teamIds: readonly string[] }>,
  query: MetricsQuery,
): Promise<Prisma.CommercialMetricFactWhereInput> {
  const scopeMemberships = scope.scope === "TEAM" ? await database.teamMember.findMany({
    where: { workspaceId: context.workspaceId, teamId: { in: [...scope.teamIds] }, deletedAt: null },
    select: { workspaceMemberId: true },
  }) : [];
  const scopedMembers = uniqueSorted(scopeMemberships.map((item) => item.workspaceMemberId));
  const selectedMembers = uniqueSorted([...query.filters.sdrMemberIds, ...query.filters.closerMemberIds]);
  const fallbackLeadIds = async (where: Prisma.LeadWhereInput) => (await database.lead.findMany({
    where: { workspaceId: context.workspaceId, ...where }, select: { id: true },
  })).map((lead) => lead.id);
  const [sourceLeadIds, campaignLeadIds, creativeLeadIds, teamLeadIds, filteredTeamMembers] = await Promise.all([
    query.filters.sourceIds.length ? fallbackLeadIds({ sourceId: { in: [...query.filters.sourceIds] } }) : null,
    query.filters.campaignIds.length ? fallbackLeadIds({ campaignId: { in: [...query.filters.campaignIds] } }) : null,
    query.filters.creativeIds.length ? fallbackLeadIds({ creativeId: { in: [...query.filters.creativeIds] } }) : null,
    query.filters.teamIds.length ? fallbackLeadIds({ OR: [
      { queue: { teamId: { in: [...query.filters.teamIds] } } },
      { routingQueue: { teamId: { in: [...query.filters.teamIds] } } },
    ] }) : null,
    query.filters.teamIds.length ? database.teamMember.findMany({
      where: { workspaceId: context.workspaceId, teamId: { in: [...query.filters.teamIds] }, deletedAt: null },
      select: { workspaceMemberId: true },
    }) : [],
  ]);
  const filteredTeamMemberIds = filteredTeamMembers.map((membership) => membership.workspaceMemberId);
  const dimensionLeadIds = query.filters.priorityCodes.length > 0 || query.filters.productIds.length > 0
    ? (await database.lead.findMany({
        where: {
          workspaceId: context.workspaceId,
          createdAt: { lt: new Date(query.to) },
          OR: [{ deletedAt: null }, { deletedAt: { gte: new Date(query.from) } }],
          ...(query.filters.productIds.length > 0 ? { AND: [{ OR: [
            { opportunities: { some: { productId: { in: [...query.filters.productIds] } } } },
            { opportunityOutcomeSnapshots: { some: { productId: { in: [...query.filters.productIds] } } } },
          ] }] } : {}),
        },
        select: {
          id: true,
          scores: { where: { calculatedAt: { lt: new Date(query.to) }, currentRevision: { not: null } }, orderBy: [{ currentRevision: "desc" }, { calculatedAt: "desc" }, { id: "desc" }], take: 1, select: { priorityBandCode: true } },
          slaCycles: { where: { receivedAt: { lt: new Date(query.to) } }, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 1, select: { priorityBand: { select: { code: true } } } },
        },
      })).filter((lead) => {
        if (query.filters.priorityCodes.length === 0) return true;
        const priority = lead.scores[0]?.priorityBandCode ?? lead.slaCycles[0]?.priorityBand.code;
        return priority ? query.filters.priorityCodes.includes(priority) : false;
      })
      .map((lead) => lead.id)
    : null;
  const visibility: Prisma.CommercialMetricFactWhereInput = scope.scope === "WORKSPACE" ? {} : scope.scope === "OWN" ? {
    OR: [
      { creditedMemberId: context.memberId }, { performedByMemberId: context.memberId },
      { leadOwnerMemberIdAtEvent: context.memberId }, { meetingOwnerMemberIdAtEvent: context.memberId },
      { opportunityOwnerMemberIdAtEvent: context.memberId }, { bookedByMemberId: context.memberId }, { originatingSdrMemberId: context.memberId },
    ],
  } : {
    OR: [
      { teamId: { in: [...scope.teamIds] } }, { creditedMemberId: { in: scopedMembers } }, { performedByMemberId: { in: scopedMembers } },
      { leadOwnerMemberIdAtEvent: { in: scopedMembers } }, { meetingOwnerMemberIdAtEvent: { in: scopedMembers } }, { opportunityOwnerMemberIdAtEvent: { in: scopedMembers } },
    ],
  };
  return {
    workspaceId: context.workspaceId,
    occurredAt: { gte: new Date(query.from), lt: new Date(query.to) },
    AND: [
      visibility,
      ...(dimensionLeadIds === null ? [] : [{ leadId: { in: dimensionLeadIds } }]),
      ...(selectedMembers.length ? [{ OR: [
        { eventType: "MEETING_SCHEDULED" as const, bookedByMemberId: { in: selectedMembers } },
        { eventType: "MEETING_SCHEDULED" as const, bookedByMemberId: null, creditedMemberId: { in: selectedMembers } },
        { eventType: "STAGE_ENTERED" as const, performedByMemberId: { in: selectedMembers } },
        { eventType: { notIn: ["MEETING_SCHEDULED" as const, "STAGE_ENTERED" as const] }, creditedMemberId: { in: selectedMembers } },
      ] }] : []),
      ...(query.filters.teamIds.length ? [{ OR: [
        { teamId: { in: [...query.filters.teamIds] } },
        { creditedMemberId: { in: filteredTeamMemberIds } },
        { performedByMemberId: { in: filteredTeamMemberIds } },
        { teamId: null, leadId: { in: teamLeadIds ?? [] } },
      ] }] : []),
      ...(sourceLeadIds === null ? [] : [{ OR: [
        { sourceId: { in: [...query.filters.sourceIds] } }, { sourceId: null, leadId: { in: sourceLeadIds } },
      ] }]),
      ...(campaignLeadIds === null ? [] : [{ OR: [
        { campaignId: { in: [...query.filters.campaignIds] } }, { campaignId: null, leadId: { in: campaignLeadIds } },
      ] }]),
      ...(creativeLeadIds === null ? [] : [{ OR: [
        { creativeId: { in: [...query.filters.creativeIds] } }, { creativeId: null, leadId: { in: creativeLeadIds } },
      ] }]),
    ],
    ...(query.filters.pipelineIds?.length ? { pipelineId: { in: [...query.filters.pipelineIds] } } : {}),
    ...(query.filters.stageIds?.length ? { stageId: { in: [...query.filters.stageIds] } } : {}),
    ...(query.filters.channels?.length ? { channel: { in: [...query.filters.channels] } } : {}),
    ...(query.filters.cadenceStepKeys?.length ? { cadenceStepKey: { in: [...query.filters.cadenceStepKeys] } } : {}),
    ...(query.filters.executionModes?.length ? { executionMode: { in: [...query.filters.executionModes] } } : {}),
    ...(query.filters.municipality?.length ? { municipality: { in: [...query.filters.municipality] } } : {}),
    ...(query.filters.stateCodes?.length ? { stateCode: { in: [...query.filters.stateCodes] } } : {}),
    ...(query.filters.politicalRoles?.length ? { politicalRole: { in: [...query.filters.politicalRoles] } } : {}),
  };
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
  async function getScheduledProspectingEmailFacts(
    context: AuthenticatedContext,
    query: MetricsQuery,
    scope: Readonly<{ scope: PermissionScope; teamIds: readonly string[] }>,
  ): Promise<readonly IntegratedActivityFact[]> {
    const jobs = await options.database.prospectingEmailJob.findMany({
      where: {
        workspaceId: context.workspaceId,
        scheduledAt: { gte: new Date(query.from), lt: new Date(query.to) },
      },
      select: { id: true, scheduledAt: true },
    });
    if (jobs.length === 0) return Object.freeze([]);

    const scopedWhere = await integratedFactWhere(options.database, context, scope, query);
    const { occurredAt: periodConstraint, ...factScopeWhere } = scopedWhere;
    void periodConstraint;
    const rows = await options.database.commercialMetricFact.findMany({
      where: {
        ...factScopeWhere,
        eventType: "EMAIL_SCHEDULED",
        sourceEntityType: "ProspectingEmailJob",
        sourceEntityId: { in: jobs.map((job) => job.id) },
      },
      select: {
        id: true, eventType: true, sourceEntityType: true, sourceEntityId: true,
        leadId: true, creditedMemberId: true, performedByMemberId: true, bookedByMemberId: true,
        taskKind: true, result: true, cadenceStepKey: true, quantity: true, valueCents: true,
      },
    });
    const scheduledAtByJobId = new Map(jobs.map((job) => [job.id, job.scheduledAt]));
    return Object.freeze(rows.map(({ sourceEntityId, ...row }) => Object.freeze({
      ...row,
      occurredAt: scheduledAtByJobId.get(sourceEntityId)?.toISOString() ?? query.from,
      valueCents: row.valueCents?.toString() ?? null,
    })));
  }

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

  async function getIntegratedOverview(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<IntegratedMetricsOverview> {
    const query = parseMetricsQuery(input);
    const to = new Date(query.to);
    const scope = await resolveMetricsScope(options.database, options.authorization, context);
    const workspace = await options.database.workspace.findFirst({ where: { id: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { timeZone: true } });
    if (!workspace) invalidInput("Workspace não encontrado.");
    const where = await integratedFactWhere(options.database, context, scope, query);
    const [groups, leadFacts, scheduledProspectingEmailFacts, latestBackfill, latestReconciliation] = await Promise.all([
      options.database.commercialMetricFact.groupBy({ by: ["eventType", "result", "sourceEntityType", "channel"], where, _sum: { quantity: true, valueCents: true }, _max: { occurredAt: true } }),
      options.database.commercialMetricFact.findMany({ where: { ...where, leadId: { not: null } }, select: { eventType: true, result: true, sourceEntityType: true, channel: true, leadId: true, quantity: true } }),
      getScheduledProspectingEmailFacts(context, query, scope),
      options.database.commercialMetricBackfillRun.findFirst({ where: { workspaceId: context.workspaceId, mode: "APPLY" }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }),
      options.database.commercialMetricReconciliationRun.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }),
    ]);
    const qualityGate = commercialMetricQuality(latestBackfill, latestReconciliation);
    const eligibleResult = (result: string | null, results?: readonly string[]) => !results || (result !== null && results.includes(result));
    const eligibleSource = (source: string, sources?: readonly string[]) => !sources || sources.includes(source);
    const eligibleChannel = (channel: string | null, channels?: readonly string[]) => !channels || (channel !== null && channels.includes(channel));
    const count = (types: readonly CommercialMetricEventType[], results?: readonly string[], sources?: readonly string[], channels?: readonly string[]) => groups
      .filter((group) => types.includes(group.eventType) && eligibleResult(group.result, results) && eligibleSource(group.sourceEntityType, sources) && eligibleChannel(group.channel, channels))
      .reduce((sum, group) => sum + Number(group._sum.quantity ?? 0), 0);
    const distinct = (types: readonly CommercialMetricEventType[], results?: readonly string[], sources?: readonly string[], channels?: readonly string[]) => {
      const balances = new Map<string, number>();
      for (const fact of leadFacts) {
        if (!types.includes(fact.eventType) || !eligibleResult(fact.result, results) || !eligibleSource(fact.sourceEntityType, sources) || !eligibleChannel(fact.channel, channels)) continue;
        const key = `${fact.eventType}:${fact.leadId}`;
        balances.set(key, (balances.get(key) ?? 0) + fact.quantity);
      }
      const leads = new Set<string>();
      for (const [key, balance] of balances) if (balance > 0) leads.add(key.slice(key.indexOf(":") + 1));
      return leads.size;
    };
    const cents = (types: readonly CommercialMetricEventType[], results?: readonly string[], sources?: readonly string[], channels?: readonly string[]) => groups
      .filter((group) => types.includes(group.eventType) && eligibleResult(group.result, results) && eligibleSource(group.sourceEntityType, sources) && eligibleChannel(group.channel, channels))
      .reduce((sum, group) => sum + (group._sum.valueCents ?? 0n), 0n);
    const newest = groups.flatMap((group) => group._max.occurredAt ? [group._max.occurredAt] : []).sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const period = Object.freeze({ from: query.from, to: query.to, timeZone: workspace.timeZone, interval: "HALF_OPEN" as const });
    const values: CanonicalMetricValue[] = integratedMetricRegistry.map((definition) => {
      const cohort = definition.aggregation === "RATE" && definition.denominatorAggregation === "DISTINCT_LEAD" && definition.denominatorEventTypes
        ? summarizeLeadCohortRate(
          leadFacts.filter((fact) => definition.eventTypes.includes(fact.eventType) && eligibleResult(fact.result, definition.results) && eligibleSource(fact.sourceEntityType, definition.sourceEntityTypes) && eligibleChannel(fact.channel, definition.channels)),
          leadFacts.filter((fact) => definition.denominatorEventTypes?.includes(fact.eventType)),
        )
        : null;
      const numerator = definition.id === "email.scheduled"
        ? count(definition.eventTypes, definition.results, ["MessageStatusEvent"], definition.channels)
          + scheduledProspectingEmailFacts.reduce((total, fact) => total + fact.quantity, 0)
        : cohort ? cohort.numerator : definition.aggregation === "DISTINCT_LEAD" ? distinct(definition.eventTypes, definition.results, definition.sourceEntityTypes, definition.channels) : definition.aggregation === "SUM_CENTS" ? cents(definition.eventTypes, definition.results, definition.sourceEntityTypes, definition.channels) : count(definition.eventTypes, definition.results, definition.sourceEntityTypes, definition.channels);
      const denominator = cohort ? cohort.denominator : definition.denominatorEventTypes
        ? definition.denominatorAggregation === "DISTINCT_LEAD" ? distinct(definition.denominatorEventTypes) : count(definition.denominatorEventTypes)
        : null;
      const noDenominator = definition.aggregation === "RATE" && denominator === 0;
      const value = definition.aggregation === "RATE" ? noDenominator ? null : Math.round(Number(numerator) * 10_000 / Number(denominator)) : definition.aggregation === "SUM_CENTS" ? (numerator as bigint).toString() : Number(numerator);
      const numericZero = definition.aggregation === "SUM_CENTS" ? numerator === 0n : Number(numerator) === 0;
      return Object.freeze({
        metricId: definition.id,
        definitionVersion: 1,
        state: noDenominator ? "NO_DENOMINATOR" as const : numericZero ? "ZERO" as const : "AVAILABLE" as const,
        value,
        unit: definition.unit,
        numerator: definition.aggregation === "SUM_CENTS" ? (numerator as bigint).toString() : Number(numerator),
        denominator,
        sampleCount: definition.aggregation === "RATE" ? denominator : definition.aggregation === "DISTINCT_LEAD" ? Number(numerator) : null,
        coverageBasisPoints: qualityGate.historicalCoverageBasisPoints,
        period,
        asOf: to.toISOString(),
        filters: query.filters,
        scope: scope.scope,
        freshnessAt: newest?.toISOString() ?? null,
        reason: noDenominator ? "Não há denominador elegível no período." : numericZero ? "Nenhum fato elegível no período." : definition.description,
        limitations: definition.limitations,
        drilldownId: `integrated:${definition.id}`,
      });
    });
    const totalFacts = count(groups.map((group) => group.eventType));
    const unattributed = await options.database.commercialMetricFact.aggregate({ where: { ...where, creditedMemberId: null }, _sum: { quantity: true } });
    const unattributedFacts = Number(unattributed._sum.quantity ?? 0);
    const coverageBasisPoints = totalFacts === 0 ? null : Math.max(0, Math.round((totalFacts - unattributedFacts) * 10_000 / totalFacts));
    return Object.freeze({
      registryVersion: INTEGRATED_METRIC_REGISTRY_VERSION,
      generatedAt: options.now().toISOString(),
      values: Object.freeze(values),
      quality: Object.freeze({
        totalFacts, unattributedFacts, coverageBasisPoints, freshnessAt: newest?.toISOString() ?? null,
        reconciliationState: qualityGate.reconciliationState, reconciliationRunId: latestReconciliation?.id ?? null,
        reconciliationExpectedCount: latestReconciliation?.expectedCount ?? null,
        reconciliationActualCount: latestReconciliation?.actualCount ?? null,
        divergentCheckCount: latestReconciliation?.divergentCheckCount ?? null,
        reason: qualityGate.reason,
      }),
    });
  }

  async function getIntegratedDrilldown(context: AuthenticatedContext, raw: unknown) {
    const parsed = integratedDrilldownSchema.safeParse(raw);
    if (!parsed.success) invalidInput(parsed.error);
    const query = parseMetricsQuery(parsed.data.query);
    const definition = integratedMetricRegistry.find((item) => item.id === parsed.data.metricId);
    if (!definition) invalidInput("Métrica integrada desconhecida.");
    const scope = await resolveMetricsScope(options.database, options.authorization, context);
    const baseWhere = await integratedFactWhere(options.database, context, scope, query);
    const cursorFact = parsed.data.cursor ? await options.database.commercialMetricFact.findFirst({
      where: { id: parsed.data.cursor, workspaceId: context.workspaceId },
      select: { id: true, occurredAt: true },
    }) : null;
    if (parsed.data.cursor && !cursorFact) invalidInput("Cursor de drill-down inválido.");
    const rows = await options.database.commercialMetricFact.findMany({
      where: {
        ...baseWhere,
        eventType: { in: [...definition.eventTypes] },
        ...(definition.sourceEntityTypes ? { sourceEntityType: { in: [...definition.sourceEntityTypes] } } : {}),
        ...(definition.channels ? { channel: { in: [...definition.channels] } } : {}),
        ...(definition.results ? { result: { in: [...definition.results] } } : {}),
        ...(cursorFact ? { OR: [{ occurredAt: { lt: cursorFact.occurredAt } }, { occurredAt: cursorFact.occurredAt, id: { lt: cursorFact.id } }] } : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit + 1,
      select: {
        id: true, eventKey: true, eventType: true, occurredAt: true, sourceEntityType: true, sourceEntityId: true,
        leadId: true, contactId: true, accountId: true, taskId: true, activityId: true, messageId: true, phoneCallId: true,
        meetingId: true, opportunityId: true, contractId: true, paymentId: true, pipelineId: true, stageId: true,
        creditedMemberId: true, performedByMemberId: true, teamId: true, sourceId: true, campaignId: true, creativeId: true,
        politicalRole: true, municipality: true, stateCode: true, channel: true, direction: true, taskKind: true, result: true,
        executionMode: true, valueCents: true, durationSeconds: true, quantity: true, producerVersion: true, definitionVersion: true,
      },
    });
    const hasMore = rows.length > parsed.data.limit;
    const page = rows.slice(0, parsed.data.limit).map((row) => Object.freeze({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      valueCents: row.valueCents?.toString() ?? null,
    }));
    return Object.freeze({
      metric: Object.freeze({ id: definition.id, label: definition.label, description: definition.description, unit: definition.unit }),
      period: Object.freeze({ from: query.from, to: query.to, interval: "HALF_OPEN" as const }),
      scope: scope.scope,
      records: Object.freeze(page),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      limitations: definition.limitations,
    });
  }

  async function getIntegratedActivityFacts(context: AuthenticatedContext, input: unknown): Promise<readonly IntegratedActivityFact[]> {
    const query = parseMetricsQuery(input);
    const scope = await resolveMetricsScope(options.database, options.authorization, context);
    const where = await integratedFactWhere(options.database, context, scope, query);
    const [rows, scheduledProspectingEmailFacts] = await Promise.all([
      options.database.commercialMetricFact.findMany({
        where: {
          ...where,
          eventType: { in: ["LEAD_CREATED", "TASK_COMPLETED", "STAGE_ENTERED", "CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED", "INBOUND_MESSAGE_RECEIVED", "HUMAN_RESPONSE_CONFIRMED", "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED", "EMAIL_SCHEDULED", "EMAIL_SENT", "EMAIL_DELIVERED", "EMAIL_REPLIED", "EMAIL_BOUNCED", "EMAIL_COMPLAINT", "EMAIL_UNSUBSCRIBED", "EMAIL_CANCELLED", "EMAIL_EXPIRED", "EMAIL_FAILED", "LEAD_QUALIFIED", "MEETING_SCHEDULED", "MEETING_COMPLETED", "PROPOSAL_REACHED", "SALE_WON"] },
          NOT: { eventType: "EMAIL_SCHEDULED", sourceEntityType: "ProspectingEmailJob" },
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { id: true, eventType: true, sourceEntityType: true, occurredAt: true, leadId: true, creditedMemberId: true, performedByMemberId: true, bookedByMemberId: true, taskKind: true, result: true, cadenceStepKey: true, quantity: true, valueCents: true },
      }),
      getScheduledProspectingEmailFacts(context, query, scope),
    ]);
    const facts = [...rows.map((row) => Object.freeze({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      valueCents: row.valueCents?.toString() ?? null,
    })), ...scheduledProspectingEmailFacts]
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    return Object.freeze(facts);
  }

  return Object.freeze({ getOverview, getIntegratedOverview, getIntegratedDrilldown, getIntegratedActivityFacts });
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
