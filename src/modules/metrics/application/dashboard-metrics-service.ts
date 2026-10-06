import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  type DashboardDrilldown,
  type DashboardDrilldownPage,
  type DashboardAttentionItem,
  type DashboardComparison,
  type DashboardFilterOption,
  type DashboardFunnelFlow,
  type DashboardFunnelNode,
  type DashboardKpi,
  type DashboardMetricInterpretation,
  type DashboardPeriodInterval,
  type DashboardPeriodPreset,
  type DashboardPerformanceRow,
  dashboardPeriodPresets,
  type DashboardQuery,
  type DashboardRecord,
  type DashboardScreen,
  type DashboardSegment,
} from "@/modules/metrics/domain/dashboard-contracts";
import {
  resolveDashboardComparisonPeriod,
  resolveDashboardPeriod,
} from "@/modules/metrics/domain/dashboard-period";
import { buildDashboardTimeSeries } from "@/modules/metrics/domain/dashboard-series";
import {
  createMetricsService,
  parseMetricsQuery,
} from "@/modules/metrics/application/metrics-service";
import type { MetricsOverview } from "@/modules/metrics/domain/metrics-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import {
  commercialFunctionForRole,
  commercialMemberWhere,
} from "@/modules/users/application/commercial-member-eligibility";
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

type DashboardMetricsServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const listParam = z.preprocess((value) => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => typeof item === "string" ? item.split(",") : []);
}, z.array(z.string()).max(100));

const inputSchema = z.object({
  preset: z.enum(dashboardPeriodPresets).optional().default("MONTH"),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sdr: listParam.optional().default([]),
  closer: listParam.optional().default([]),
  team: listParam.optional().default([]),
  source: listParam.optional().default([]),
  campaign: listParam.optional().default([]),
  creative: listParam.optional().default([]),
  priority: listParam.optional().default([]),
  product: listParam.optional().default([]),
}).passthrough();

const drilldownSchema = z.object({
  view: z.string().min(1).max(160),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).optional().default(50),
});

function invalidInput(error: z.ZodError | string): never {
  throw new ApplicationError(
    typeof error === "string" ? error : error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function optionSort(options: readonly DashboardFilterOption[]) {
  return [...options].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

function durationSeconds(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1_000));
}

function leadKey(id: string) { return `lead:${id}`; }
function meetingKey(id: string) { return `meeting:${id}`; }
function opportunityKey(id: string) { return `opportunity:${id}`; }
function slaKey(id: string) { return `sla:${id}`; }
function automationRunKey(id: string) { return `automation-run:${id}`; }

type ComparableMetric = Readonly<{
  id: string;
  label: string;
  kind: "COUNT" | "RATE" | "MONEY" | "DURATION";
  value: number | string | null;
  numerator: number | string;
  denominator: number | null;
  keys: readonly string[];
  formula: string;
  desiredDirection: "UP" | "DOWN" | "CONTEXT";
}>;

function periodInterval(
  query: DashboardQuery,
  timeZone: string,
): DashboardPeriodInterval {
  return Object.freeze({
    fromDate: query.fromDate,
    toDate: query.toDate,
    from: query.from,
    to: query.to,
    timeZone,
  });
}

function comparableMetrics(overview: MetricsOverview): readonly ComparableMetric[] {
  const evidence = overview.evidence;
  const leadKeys = (ids: readonly string[]) => ids.map(leadKey);
  const meetingKeys = (rows: readonly Readonly<{ meetingId: string }>[]) => rows.map((row) => meetingKey(row.meetingId));
  const opportunityKeys = (rows: readonly Readonly<{ opportunityId: string }>[]) => rows.map((row) => opportunityKey(row.opportunityId));
  const slaKeys = evidence.slaCycles.map((row) => slaKey(row.cycleId));
  const rateValue = (rate: Readonly<{ percentage: number | null }>) => rate.percentage;
  return Object.freeze([
    { id: "leads", label: "Leads recebidos", kind: "COUNT", value: evidence.leadReceipts.length, numerator: evidence.leadReceipts.length, denominator: null, keys: leadKeys(evidence.leadsReceivedLeadIds), formula: "novas identidades recebidas no período", desiredDirection: "CONTEXT" },
    { id: "attempts", label: "Primeiras tentativas", kind: "COUNT", value: evidence.firstAttempts.length, numerator: evidence.firstAttempts.length, denominator: evidence.leadReceipts.length, keys: leadKeys(evidence.attemptedLeadIds), formula: "leads tentados / leads recebidos", desiredDirection: "UP" },
    { id: "connected", label: "Leads conectados", kind: "COUNT", value: evidence.firstConnections.length, numerator: evidence.firstConnections.length, denominator: evidence.firstAttempts.length, keys: leadKeys(evidence.contactedLeadIds), formula: "leads conectados / leads tentados", desiredDirection: "UP" },
    { id: "qualified", label: "Qualificados", kind: "COUNT", value: evidence.qualifications.length, numerator: evidence.qualifications.length, denominator: evidence.leadReceipts.length, keys: leadKeys(evidence.qualifiedLeadIds), formula: "leads qualificados / leads recebidos", desiredDirection: "UP" },
    { id: "scheduled", label: "Reuniões agendadas", kind: "COUNT", value: evidence.scheduledMeetings.length, numerator: evidence.scheduledMeetings.length, denominator: evidence.qualifications.length, keys: leadKeys(evidence.scheduledLeadIds), formula: "qualificados agendados / qualificados", desiredDirection: "UP" },
    { id: "held", label: "Reuniões realizadas", kind: "COUNT", value: evidence.heldMeetings.length, numerator: evidence.heldMeetings.length, denominator: evidence.heldMeetings.length + evidence.noShowMeetings.length, keys: meetingKeys(evidence.heldMeetings), formula: "reuniões realizadas / reuniões decididas", desiredDirection: "UP" },
    { id: "no-show", label: "No-shows", kind: "COUNT", value: evidence.noShowMeetings.length, numerator: evidence.noShowMeetings.length, denominator: evidence.heldMeetings.length + evidence.noShowMeetings.length, keys: meetingKeys(evidence.noShowMeetings), formula: "no-shows / reuniões decididas", desiredDirection: "DOWN" },
    { id: "opportunities", label: "Oportunidades", kind: "COUNT", value: evidence.opportunitiesCreated.length, numerator: evidence.opportunitiesCreated.length, denominator: null, keys: opportunityKeys(evidence.opportunitiesCreated), formula: "oportunidades criadas no período", desiredDirection: "UP" },
    { id: "proposals", label: "Propostas", kind: "COUNT", value: evidence.proposals.length, numerator: evidence.proposals.length, denominator: evidence.opportunitiesCreated.length, keys: opportunityKeys(evidence.proposals), formula: "oportunidades que entraram em Proposta / oportunidades criadas", desiredDirection: "UP" },
    { id: "sales", label: "Vendas", kind: "COUNT", value: evidence.periodWins.length, numerator: evidence.periodWins.length, denominator: evidence.leadReceipts.length, keys: opportunityKeys(evidence.periodWins), formula: "ganhos vigentes no período", desiredDirection: "UP" },
    { id: "losses", label: "Perdas", kind: "COUNT", value: evidence.periodLosses.length, numerator: evidence.periodLosses.length, denominator: evidence.opportunitiesCreated.length, keys: opportunityKeys(evidence.periodLosses), formula: "perdas vigentes no período", desiredDirection: "CONTEXT" },
    { id: "disqualified", label: "Desqualificados", kind: "COUNT", value: evidence.disqualifications.length, numerator: evidence.disqualifications.length, denominator: evidence.leadReceipts.length, keys: leadKeys(evidence.disqualifications.map((row) => row.leadId)), formula: "desqualificações ocorridas no período e vigentes no corte", desiredDirection: "CONTEXT" },
    { id: "revenue", label: "Receita", kind: "MONEY", value: overview.revenue.cents, numerator: overview.revenue.numerator, denominator: null, keys: opportunityKeys(evidence.periodWins), formula: "soma de amountCents dos ganhos vigentes", desiredDirection: "UP" },
    { id: "mrr", label: "MRR vendido no período", kind: "MONEY", value: overview.mrr.cents, numerator: overview.mrr.numerator, denominator: null, keys: opportunityKeys(evidence.periodWins), formula: "soma de mrrCents dos ganhos vigentes", desiredDirection: "UP" },
    { id: "tcv", label: "TCV", kind: "MONEY", value: overview.tcv.cents, numerator: overview.tcv.numerator, denominator: null, keys: opportunityKeys(evidence.periodWins), formula: "soma de tcvCents dos ganhos vigentes", desiredDirection: "UP" },
    { id: "ticket", label: "Ticket médio", kind: "MONEY", value: overview.averageTicket.cents, numerator: overview.averageTicket.numeratorCents, denominator: overview.averageTicket.denominator, keys: opportunityKeys(evidence.periodWins), formula: "receita em centavos / ganhos vigentes", desiredDirection: "CONTEXT" },
    { id: "sla-average", label: "SLA humano médio", kind: "DURATION", value: overview.humanSla.averageSeconds, numerator: overview.humanSla.sampleCount, denominator: overview.humanSla.sampleCount + overview.humanSla.missingCount, keys: slaKeys, formula: "média dos segundos até a primeira tentativa", desiredDirection: "DOWN" },
    { id: "sla-median", label: "Mediana do SLA humano", kind: "DURATION", value: overview.humanSla.medianSeconds, numerator: overview.humanSla.sampleCount, denominator: overview.humanSla.sampleCount + overview.humanSla.missingCount, keys: slaKeys, formula: "mediana dos segundos até a primeira tentativa", desiredDirection: "DOWN" },
    { id: "sla-p90", label: "P90 do SLA humano", kind: "DURATION", value: overview.humanSla.p90Seconds, numerator: overview.humanSla.sampleCount, denominator: overview.humanSla.sampleCount + overview.humanSla.missingCount, keys: slaKeys, formula: "P90 dos segundos até a primeira tentativa", desiredDirection: "DOWN" },
    { id: "lead-to-sale", label: "Conversão lead → venda", kind: "RATE", value: rateValue(overview.leadToSaleRate), numerator: overview.leadToSaleRate.numerator, denominator: overview.leadToSaleRate.denominator, keys: leadKeys(evidence.leadsReceivedLeadIds), formula: "leads recebidos com ganho vigente / leads recebidos", desiredDirection: "UP" },
    { id: "backlog", label: "Leads abertos", kind: "COUNT", value: overview.backlog.value, numerator: overview.backlog.value, denominator: null, keys: leadKeys(evidence.openLeadIds), formula: "leads em etapa aberta no corte", desiredDirection: "CONTEXT" },
    { id: "stalled", label: "Leads parados", kind: "COUNT", value: overview.stalledLeads.value, numerator: overview.stalledLeads.value, denominator: overview.backlog.value, keys: leadKeys(evidence.stalledLeadIds), formula: "backlog acima do limite de estagnação", desiredDirection: "DOWN" },
    { id: "no-next-action", label: "Sem próxima ação", kind: "COUNT", value: overview.leadsWithoutNextAction.value, numerator: overview.leadsWithoutNextAction.value, denominator: overview.backlog.value, keys: leadKeys(evidence.leadsWithoutNextActionIds), formula: "backlog sem tarefa ativa", desiredDirection: "DOWN" },
  ] satisfies readonly ComparableMetric[]);
}

function percentageDifference(
  current: number | string | null,
  previous: number | string | null,
): number | null {
  if (current === null || previous === null) return null;
  if (typeof current === "string" || typeof previous === "string") {
    const currentValue = BigInt(current);
    const previousValue = BigInt(previous);
    if (previousValue === 0n) return null;
    return Number(((currentValue - previousValue) * 10_000n) / (previousValue < 0n ? -previousValue : previousValue)) / 100;
  }
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

function absoluteDifference(
  current: number | string | null,
  previous: number | string | null,
): number | string | null {
  if (current === null || previous === null) return null;
  if (typeof current === "string" || typeof previous === "string") {
    return (BigInt(current) - BigInt(previous)).toString();
  }
  return Math.round((current - previous) * 100) / 100;
}

function interpretation(
  desired: ComparableMetric["desiredDirection"],
  direction: DashboardComparison["direction"],
): Readonly<{ code: DashboardMetricInterpretation; label: string }> {
  if (direction === "NOT_COMPARABLE") return { code: "NOT_ENOUGH_DATA", label: "Sem base suficiente para comparar." };
  if (direction === "STABLE") return { code: "NEUTRAL", label: "Sem variação no período comparado." };
  if (desired === "CONTEXT") return { code: "CONTEXT_REQUIRED", label: "A variação exige contexto operacional; não indica melhora ou piora sozinha." };
  const positive = (desired === "UP" && direction === "UP") || (desired === "DOWN" && direction === "DOWN");
  return positive
    ? { code: "POSITIVE", label: "Variação favorável segundo a direção esperada desta métrica." }
    : { code: "NEGATIVE", label: "Variação desfavorável segundo a direção esperada desta métrica." };
}

function trendDirection(
  current: number | string | null,
  previous: number | string | null,
): DashboardComparison["direction"] {
  if (current === null || previous === null) return "NOT_COMPARABLE";
  const comparison = typeof current === "string" || typeof previous === "string"
    ? BigInt(current) === BigInt(previous) ? 0 : BigInt(current) > BigInt(previous) ? 1 : -1
    : current === previous ? 0 : current > previous ? 1 : -1;
  return comparison === 0 ? "STABLE" : comparison > 0 ? "UP" : "DOWN";
}

export function createDashboardMetricsService(options: DashboardMetricsServiceOptions) {
  const metrics = createMetricsService(options);

  async function parseQuery(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<DashboardQuery> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const workspace = await options.database.workspace.findFirst({
      where: { id: context.workspaceId, status: "ACTIVE", deletedAt: null },
      select: { timeZone: true },
    });
    if (!workspace) {
      throw new ApplicationError("Workspace não encontrado.", {
        code: "NOT_FOUND", statusCode: 404, expose: true,
      });
    }
    const period = resolveDashboardPeriod(
      parsed.data.preset as DashboardPeriodPreset,
      parsed.data.fromDate,
      parsed.data.toDate,
      options.now(),
      workspace.timeZone,
    );
    const normalized = parseMetricsQuery({
      from: period.from,
      to: period.to,
      filters: {
        sdrMemberIds: parsed.data.sdr,
        closerMemberIds: parsed.data.closer,
        teamIds: parsed.data.team,
        sourceIds: parsed.data.source,
        campaignIds: parsed.data.campaign,
        creativeIds: parsed.data.creative,
        priorityCodes: parsed.data.priority,
        productIds: parsed.data.product,
      },
    });
    return Object.freeze({ ...period, filters: normalized.filters });
  }

  async function getScreen(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<DashboardScreen> {
    const query = await parseQuery(context, input);
    const [overview, integrated] = await Promise.all([
      metrics.getOverview(context, { from: query.from, to: query.to, filters: query.filters }),
      metrics.getIntegratedOverview(context, { from: query.from, to: query.to, filters: query.filters }),
    ]);
    const comparisonPeriod = resolveDashboardComparisonPeriod(
      query,
      overview.period.timeZone,
    );
    const previousOverview = await metrics.getOverview(context, {
      from: comparisonPeriod.from,
      to: comparisonPeriod.to,
      filters: query.filters,
    });
    const from = new Date(query.from);
    const to = new Date(query.to);
    const comparisonFrom = new Date(comparisonPeriod.from);
    const combinedUniverse = unique([
      ...overview.evidence.universeLeadIds,
      ...previousOverview.evidence.universeLeadIds,
    ]);
    const ids = combinedUniverse.length > 0
      ? combinedUniverse
      : ["00000000-0000-0000-0000-000000000000"];

    const ownTeams = overview.scope === "WORKSPACE"
      ? []
      : await options.database.teamMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            workspaceMemberId: context.memberId,
            deletedAt: null,
            team: { deletedAt: null },
          },
          select: { teamId: true },
        });
    const allowedMemberWhere = overview.scope === "WORKSPACE"
      ? {}
      : overview.scope === "TEAM"
        ? { teamId: { in: ownTeams.map((item) => item.teamId) } }
        : { workspaceMemberId: context.memberId };

    const [leads, teamMembers, commercialMembers, sources, campaigns, creatives, products, workspaceSettings, failedAutomationRuns] = await Promise.all([
      options.database.lead.findMany({
        where: { workspaceId: context.workspaceId, id: { in: ids } },
        select: {
          id: true,
          fullName: true,
          createdAt: true,
          sourceId: true,
          campaignId: true,
          creativeId: true,
          disqualificationReason: { select: { id: true, name: true } },
          source: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
          creative: { select: { id: true, name: true } },
          currentStage: { select: { id: true, name: true } },
          owner: { select: { id: true, user: { select: { displayName: true } } } },
          scores: {
            where: { calculatedAt: { lt: to }, currentRevision: { not: null } },
            orderBy: [{ currentRevision: "desc" }, { calculatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { priorityBandCode: true },
          },
          slaCycles: {
            where: {
              receivedAt: { gte: comparisonFrom, lt: to },
              ...(query.filters.sdrMemberIds.length > 0
                ? { assignedMemberId: { in: [...query.filters.sdrMemberIds] } }
                : {}),
            },
            orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
            select: {
              id: true, receivedAt: true, firstHumanAttemptAt: true,
              firstHumanAttemptSeconds: true, firstConnectedAt: true,
              assignedMember: { select: { id: true, user: { select: { displayName: true } } } },
              assignedQueue: { select: { name: true } },
              priorityBand: { select: { code: true } },
            },
          },
          stageHistory: {
            where: { enteredAt: { lt: to } },
            orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
            select: {
              id: true, pipelineId: true, stageId: true, enteredAt: true, exitedAt: true,
              stage: { select: { name: true, position: true, leadStageCode: true } },
              pipeline: { select: { name: true } },
            },
          },
          meetingHistory: {
            where: {
              occurredAt: { lt: to },
              ...(query.filters.closerMemberIds.length > 0
                ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
                : {}),
            },
            orderBy: [{ meetingRevision: "asc" }, { id: "asc" }],
            select: {
              meetingId: true, meetingRevision: true, newStatus: true, newStartsAt: true,
              occurredAt: true, reason: true,
              owner: { select: { id: true, user: { select: { displayName: true } } } },
            },
          },
          qualification: {
            select: {
              status: true, minimumRequiredDimensions: true,
              assessments: { select: { status: true, validatedAt: true } },
            },
          },
          opportunities: {
            where: {
              createdAt: { lt: to },
              OR: [{ deletedAt: null }, { deletedAt: { gte: from } }],
              ...(query.filters.closerMemberIds.length > 0
                ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
                : {}),
              ...(query.filters.productIds.length > 0
                ? { productId: { in: [...query.filters.productIds] } }
                : {}),
            },
            select: {
              id: true, name: true, status: true, createdAt: true, amountCents: true,
              owner: { select: { id: true, user: { select: { displayName: true } } } },
              product: { select: { id: true, name: true } },
              stageHistory: {
                where: { enteredAt: { lt: to } },
                orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
                select: {
                  id: true, pipelineId: true, stageId: true, enteredAt: true, exitedAt: true,
                  stage: { select: { name: true, position: true, opportunityStageCode: true } },
                  pipeline: { select: { name: true } },
                },
              },
            },
          },
          opportunityOutcomeSnapshots: {
            where: {
              occurredAt: { lt: to },
              ...(query.filters.closerMemberIds.length > 0
                ? { ownerMemberId: { in: [...query.filters.closerMemberIds] } }
                : {}),
              ...(query.filters.productIds.length > 0
                ? { productId: { in: [...query.filters.productIds] } }
                : {}),
            },
            select: {
              id: true, opportunityId: true, status: true, amountCents: true,
              occurredAt: true, lossReason: { select: { id: true, name: true } },
              stageHistory: { select: { exitedAt: true } },
            },
          },
        },
      }),
      options.database.teamMember.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          member: { status: "ACTIVE", deletedAt: null, user: { status: "ACTIVE", deletedAt: null } },
          team: { deletedAt: null },
          ...allowedMemberWhere,
        },
        select: {
          function: true,
          team: { select: { id: true, name: true } },
          member: { select: { id: true, user: { select: { displayName: true } } } },
        },
      }),
      options.database.workspaceMember.findMany({
        where: commercialMemberWhere({
          workspaceId: context.workspaceId,
          functions: ["SDR", "CLOSER"],
          ...(overview.scope === "TEAM"
            ? { teamIds: ownTeams.map((item) => item.teamId) }
            : {}),
          ...(overview.scope === "OWN" ? { memberId: context.memberId } : {}),
        }),
        orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          role: { select: { key: true } },
          user: { select: { displayName: true } },
          teamMemberships: {
            where: {
              function: { in: ["SDR", "CLOSER"] },
              deletedAt: null,
              team: { deletedAt: null },
            },
            select: { function: true },
          },
        },
      }),
      options.database.leadSource.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true },
      }),
      options.database.acquisitionCampaign.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true },
      }),
      options.database.acquisitionCreative.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true },
      }),
      options.database.product.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true },
      }),
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { leadStagnationDays: true },
      }),
      options.database.automationRun.findMany({
        where: {
          workspaceId: context.workspaceId,
          status: "FAILED",
          leadId: { in: ids },
          triggeredAt: { gte: from, lt: to },
        },
        orderBy: [{ triggeredAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          leadId: true,
          triggeredAt: true,
          errorMessage: true,
          rule: { select: { name: true } },
          actor: { select: { displayName: true } },
          lead: { select: { fullName: true } },
        },
      }),
    ]);

    const records = new Map<string, DashboardRecord>();
    const drilldowns = new Map<string, DashboardDrilldown>();
    const addDrilldown = (id: string, title: string, description: string, formula: string, keys: readonly string[]) => {
      drilldowns.set(id, Object.freeze({ id, title, description, formula, recordKeys: Object.freeze(unique(keys)) }));
      return id;
    };

    for (const lead of leads) {
      records.set(leadKey(lead.id), Object.freeze({
        key: leadKey(lead.id), entityType: "LEAD", entityId: lead.id, leadId: lead.id,
        title: lead.fullName,
        subtitle: `${lead.source.name} · ${lead.currentStage.name}`,
        occurredAt: lead.createdAt.toISOString(), responsibleName: lead.owner?.user.displayName ?? "Fila operacional",
        status: lead.currentStage.name, amountCents: null, href: `/leads/${lead.id}/historico`,
      }));
      for (const cycle of lead.slaCycles) {
        records.set(slaKey(cycle.id), Object.freeze({
          key: slaKey(cycle.id), entityType: "SLA_CYCLE", entityId: cycle.id, leadId: lead.id,
          title: lead.fullName, subtitle: "Ciclo de SLA da entrada",
          occurredAt: cycle.receivedAt.toISOString(),
          responsibleName: cycle.assignedMember?.user.displayName ?? cycle.assignedQueue?.name ?? "Fila operacional",
          status: cycle.firstHumanAttemptAt ? "Tentativa registrada" : "Sem tentativa",
          amountCents: null, href: `/leads/${lead.id}/historico#timeline`,
        }));
      }
      const latestMeetings = new Map<string, (typeof lead.meetingHistory)[number]>();
      for (const history of lead.meetingHistory) {
        const current = latestMeetings.get(history.meetingId);
        if (!current || current.meetingRevision <= history.meetingRevision) latestMeetings.set(history.meetingId, history);
      }
      for (const meeting of latestMeetings.values()) {
        records.set(meetingKey(meeting.meetingId), Object.freeze({
          key: meetingKey(meeting.meetingId), entityType: "MEETING", entityId: meeting.meetingId, leadId: lead.id,
          title: lead.fullName, subtitle: "Reunião interna", occurredAt: meeting.newStartsAt.toISOString(),
          responsibleName: meeting.owner.user.displayName, status: meeting.newStatus, amountCents: null,
          href: `/agenda/reunioes/${meeting.meetingId}`,
        }));
      }
      for (const opportunity of lead.opportunities) {
        records.set(opportunityKey(opportunity.id), Object.freeze({
          key: opportunityKey(opportunity.id), entityType: "OPPORTUNITY", entityId: opportunity.id, leadId: lead.id,
          title: opportunity.name, subtitle: `${lead.fullName}${opportunity.product ? ` · ${opportunity.product.name}` : ""}`,
          occurredAt: opportunity.createdAt.toISOString(), responsibleName: opportunity.owner.user.displayName,
          status: opportunity.status, amountCents: opportunity.amountCents.toString(),
          href: `/leads/${lead.id}/historico#oportunidade`,
        }));
      }
    }
    for (const run of failedAutomationRuns) {
      if (!run.leadId || !run.lead) continue;
      records.set(automationRunKey(run.id), Object.freeze({
        key: automationRunKey(run.id), entityType: "AUTOMATION_RUN", entityId: run.id,
        leadId: run.leadId, title: run.rule.name,
        subtitle: `${run.lead.fullName} · ${run.errorMessage ?? "Falha registrada sem mensagem adicional"}`,
        occurredAt: run.triggeredAt.toISOString(), responsibleName: run.actor.displayName,
        status: "Falha", amountCents: null, href: `/automacoes?status=FAILED&leadId=${run.leadId}`,
      }));
    }

    const cohort = new Set(overview.evidence.leadsReceivedLeadIds);
    const qualified = new Set(overview.evidence.qualifiedLeadIds);
    const attempted = new Set(overview.evidence.attemptedLeadIds);
    const contacted = new Set(overview.evidence.contactedLeadIds);
    const scheduled = new Set(overview.evidence.scheduledLeadIds);
    const cohortKeys = [...cohort].map(leadKey);
    const keysFor = (idsForKeys: ReadonlySet<string>) => [...idsForKeys].map(leadKey);
    const heldKeys = overview.evidence.heldMeetings.map((item) => meetingKey(item.meetingId));
    const noShowKeys = overview.evidence.noShowMeetings.map((item) => meetingKey(item.meetingId));
    const winKeys = overview.evidence.periodWins.map((item) => opportunityKey(item.opportunityId));
    const slaKeys = overview.evidence.slaCycles.map((item) => slaKey(item.cycleId));

    const periodOpportunities = leads.flatMap((lead) => lead.opportunities
      .filter((item) => item.createdAt >= from && item.createdAt < to)
      .map((item) => ({ lead, item })));
    const proposalOpportunities = leads.flatMap((lead) => lead.opportunities
      .filter((item) => item.stageHistory.some((history) =>
        history.stage.opportunityStageCode === "PROPOSAL"
        && history.enteredAt >= from && history.enteredAt < to))
      .map((item) => ({ lead, item })));

    const kpis: DashboardKpi[] = [];
    const addKpi = (kpi: Omit<DashboardKpi, "drilldownId">, keys: readonly string[], formula: string) => {
      const drilldownId = addDrilldown(`kpi.${kpi.id}`, kpi.label, kpi.detail, formula, keys);
      kpis.push(Object.freeze({ ...kpi, drilldownId }));
    };
    addKpi({ id: "leads", label: "Leads recebidos", kind: "COUNT", value: cohort.size, numerator: cohort.size, denominator: null, detail: "Novas identidades recebidas no período." }, cohortKeys, "LeadFormSubmission com resultado CREATED no período");
    addKpi({ id: "attempts", label: "Tentativas", kind: "COUNT", value: attempted.size, numerator: attempted.size, denominator: cohort.size, detail: "Leads recebidos com primeira tentativa humana até o corte." }, keysFor(attempted), "leads tentados / leads recebidos");
    addKpi({ id: "connected", label: "Conectados", kind: "COUNT", value: contacted.size, numerator: contacted.size, denominator: attempted.size, detail: "Leads com primeira conexão humana." }, keysFor(contacted), "leads conectados / leads tentados");
    addKpi({ id: "qualified", label: "Qualificados", kind: "COUNT", value: qualified.size, numerator: qualified.size, denominator: cohort.size, detail: "Leads da coorte que entraram em Qualificado." }, keysFor(qualified), "leads qualificados / leads recebidos");
    addKpi({ id: "scheduled", label: "Reuniões agendadas", kind: "COUNT", value: scheduled.size, numerator: scheduled.size, denominator: qualified.size, detail: "Leads qualificados com agendamento registrado." }, keysFor(scheduled), "qualificados agendados / qualificados");
    addKpi({ id: "held", label: "Reuniões realizadas", kind: "COUNT", value: heldKeys.length, numerator: heldKeys.length, denominator: heldKeys.length + noShowKeys.length, detail: "Reuniões decididas com comparecimento." }, heldKeys, "reuniões realizadas / reuniões decididas");
    addKpi({ id: "no-show", label: "No-shows", kind: "COUNT", value: noShowKeys.length, numerator: noShowKeys.length, denominator: heldKeys.length + noShowKeys.length, detail: "Reuniões decididas sem comparecimento." }, noShowKeys, "no-shows / reuniões decididas");
    addKpi({ id: "opportunities", label: "Oportunidades", kind: "COUNT", value: periodOpportunities.length, numerator: periodOpportunities.length, denominator: null, detail: "Oportunidades criadas no período." }, periodOpportunities.map(({ item }) => opportunityKey(item.id)), "oportunidades criadas no período");
    addKpi({ id: "proposals", label: "Propostas", kind: "COUNT", value: proposalOpportunities.length, numerator: proposalOpportunities.length, denominator: periodOpportunities.length, detail: "Oportunidades que entraram em Proposta no período." }, proposalOpportunities.map(({ item }) => opportunityKey(item.id)), "oportunidades em Proposta / oportunidades criadas");
    addKpi({ id: "sales", label: "Vendas", kind: "COUNT", value: winKeys.length, numerator: winKeys.length, denominator: cohort.size, detail: "Ganhos vigentes ocorridos no período." }, winKeys, "ganhos vigentes / leads recebidos");
    addKpi({ id: "revenue", label: "Receita", kind: "MONEY", value: overview.revenue.cents, numerator: overview.revenue.numerator, denominator: null, detail: "Valor congelado dos ganhos do período." }, winKeys, "soma de amountCents dos ganhos vigentes");
    addKpi({ id: "mrr", label: "MRR vendido no período", kind: "MONEY", value: overview.mrr.cents, numerator: overview.mrr.numerator, denominator: null, detail: "MRR congelado dos ganhos do período." }, winKeys, "soma de mrrCents dos ganhos vigentes");
    addKpi({ id: "tcv", label: "TCV", kind: "MONEY", value: overview.tcv.cents, numerator: overview.tcv.numerator, denominator: null, detail: "TCV congelado dos ganhos do período." }, winKeys, "soma de tcvCents dos ganhos vigentes");
    addKpi({ id: "ticket", label: "Ticket médio", kind: "MONEY", value: overview.averageTicket.cents, numerator: overview.averageTicket.numeratorCents, denominator: overview.averageTicket.denominator, detail: "Receita dividida pela quantidade de ganhos." }, winKeys, "receita em centavos / ganhos vigentes");
    addKpi({ id: "sla", label: "SLA humano médio", kind: "DURATION", value: overview.humanSla.averageSeconds, numerator: overview.humanSla.sampleCount, denominator: overview.humanSla.sampleCount + overview.humanSla.missingCount, detail: "Segundos até a primeira tentativa; ausentes permanecem visíveis." }, slaKeys, "soma dos segundos medidos / ciclos medidos");
    addKpi({ id: "backlog", label: "Leads abertos", kind: "COUNT", value: overview.backlog.value, numerator: overview.backlog.value, denominator: null, detail: "Leads em etapa aberta no corte." }, overview.evidence.openLeadIds.map(leadKey), "leads em intervalo de etapa aberto no corte");
    addKpi({ id: "stalled", label: "Leads parados", kind: "COUNT", value: overview.stalledLeads.value, numerator: overview.stalledLeads.value, denominator: overview.backlog.value, detail: "Backlog acima do limite persistido de estagnação." }, overview.evidence.stalledLeadIds.map(leadKey), "backlog acima do limite de dias na etapa");
    addKpi({ id: "no-next-action", label: "Sem próxima ação", kind: "COUNT", value: overview.leadsWithoutNextAction.value, numerator: overview.leadsWithoutNextAction.value, denominator: overview.backlog.value, detail: "Backlog sem tarefa ativa no corte." }, overview.evidence.leadsWithoutNextActionIds.map(leadKey), "backlog sem tarefa ativa no corte");

    const currentPeriod = periodInterval(query, overview.period.timeZone);
    const currentComparable = comparableMetrics(overview);
    const previousComparable = new Map(comparableMetrics(previousOverview).map((metric) => [metric.id, metric]));
    const comparisons: DashboardComparison[] = currentComparable.map((currentMetric) => {
      const previousMetric = previousComparable.get(currentMetric.id)!;
      const currentDrilldownId = addDrilldown(
        `comparison.current.${currentMetric.id}`,
        `${currentMetric.label} · período atual`,
        `Registros do intervalo atual ${currentPeriod.fromDate} a ${currentPeriod.toDate}.`,
        currentMetric.formula,
        currentMetric.keys,
      );
      const previousDrilldownId = addDrilldown(
        `comparison.previous.${previousMetric.id}`,
        `${previousMetric.label} · período anterior`,
        `Registros do intervalo anterior ${comparisonPeriod.fromDate} a ${comparisonPeriod.toDate}.`,
        previousMetric.formula,
        previousMetric.keys,
      );
      const direction = trendDirection(currentMetric.value, previousMetric.value);
      const meaning = interpretation(currentMetric.desiredDirection, direction);
      return Object.freeze({
        id: currentMetric.id,
        label: currentMetric.label,
        kind: currentMetric.kind,
        current: Object.freeze({
          value: currentMetric.value,
          numerator: currentMetric.numerator,
          denominator: currentMetric.denominator,
          drilldownId: currentDrilldownId,
        }),
        previous: Object.freeze({
          value: previousMetric.value,
          numerator: previousMetric.numerator,
          denominator: previousMetric.denominator,
          drilldownId: previousDrilldownId,
        }),
        absoluteDifference: absoluteDifference(currentMetric.value, previousMetric.value),
        percentageDifference: percentageDifference(currentMetric.value, previousMetric.value),
        direction,
        interpretation: meaning.code,
        interpretationLabel: meaning.label,
        currentPeriod,
        previousPeriod: comparisonPeriod,
      });
    });

    const funnelSets = [
      ["recebidos", "Recebidos", cohort],
      ["tentados", "Tentados", attempted],
      ["conectados", "Conectados", contacted],
      ["qualificados", "Qualificados", qualified],
      ["agendados", "Agendados", scheduled],
    ] as const;
    const funnel: DashboardSegment[] = funnelSets.map(([id, label, set], index) => {
      const denominator = index === 0 ? null : (funnelSets[index - 1]?.[2].size ?? null);
      return Object.freeze({
        id, label, value: set.size, denominator,
        percentage: denominator === null ? null : percent(set.size, denominator),
        secondaryValue: null, secondaryLabel: null,
        drilldownId: addDrilldown(`funnel.${id}`, `${label} no funil`, "Registros desta etapa do funil de entrada.", index === 0 ? "novos leads" : `${label.toLowerCase()} / etapa anterior`, keysFor(set)),
      });
    });
    funnel.push(Object.freeze({
      id: "vendas", label: "Vendas", value: winKeys.length, denominator: scheduled.size,
      percentage: percent(winKeys.length, scheduled.size), secondaryValue: null, secondaryLabel: null,
      drilldownId: addDrilldown("funnel.vendas", "Vendas no funil", "Ganhos vigentes ocorridos no período.", "ganhos / agendados", winKeys),
    }));

    const fullFunnelStageSets = [
      ["received", "Lead recebido", cohort, null],
      ["attempted", "Tentativa", attempted, "received"],
      ["connected", "Conectado", contacted, "attempted"],
      ["qualified", "Qualificado", qualified, "connected"],
      ["meeting", "Reunião", scheduled, "qualified"],
      ["opportunity", "Oportunidade", new Set(overview.evidence.opportunitiesCreated.filter((row) => cohort.has(row.leadId)).map((row) => row.leadId)), "meeting"],
      ["proposal", "Proposta", new Set(overview.evidence.proposals.filter((row) => cohort.has(row.leadId)).map((row) => row.leadId)), "opportunity"],
    ] as const;
    const fullFunnelStages: DashboardFunnelNode[] = fullFunnelStageSets.map(([id, label, values, branchFrom], index) => {
      const denominator = index === 0 ? null : fullFunnelStageSets[index - 1]![2].size;
      return Object.freeze({
        id,
        label,
        value: values.size,
        denominator,
        percentage: denominator === null ? null : percent(values.size, denominator),
        secondaryValue: null,
        secondaryLabel: null,
        branchFrom,
        nodeType: "STAGE" as const,
        drilldownId: addDrilldown(
          `full-funnel.${id}`,
          `${label} · funil completo`,
          "Leads da coorte que alcançaram este marco até o corte do período.",
          denominator === null ? "leads recebidos" : `${label.toLocaleLowerCase("pt-BR")} / etapa anterior`,
          [...values].map(leadKey),
        ),
      });
    });
    const outcomeDefinitions = [
      ["won", "Ganho", new Set(overview.evidence.periodWins.filter((row) => cohort.has(row.leadId)).map((row) => row.leadId)), "proposal", "Ganhos vigentes da coorte no período."],
      ["lost", "Perdido", new Set(overview.evidence.periodLosses.filter((row) => cohort.has(row.leadId)).map((row) => row.leadId)), "proposal", "Perdas vigentes da coorte no período."],
      ["disqualified", "Desqualificado", new Set(overview.evidence.disqualifications.filter((row) => cohort.has(row.leadId)).map((row) => row.leadId)), "received", "Leads da coorte desqualificados no período e ainda vigentes no corte."],
    ] as const;
    const branchDenominators = new Map(fullFunnelStages.map((node) => [node.id, node.value]));
    const fullFunnelOutcomes: DashboardFunnelNode[] = outcomeDefinitions.map(([id, label, values, branchFrom, description]) => {
      const denominator = branchDenominators.get(branchFrom) ?? 0;
      return Object.freeze({
        id,
        label,
        value: values.size,
        denominator,
        percentage: percent(values.size, denominator),
        secondaryValue: null,
        secondaryLabel: null,
        branchFrom,
        nodeType: "OUTCOME" as const,
        drilldownId: addDrilldown(
          `full-funnel.${id}`,
          `${label} · desfecho`,
          description,
          `${label.toLocaleLowerCase("pt-BR")} / ${branchFrom === "received" ? "leads recebidos" : "propostas"}`,
          [...values].map(leadKey),
        ),
      });
    });
    const fullFunnel: DashboardFunnelFlow = Object.freeze({
      stages: Object.freeze(fullFunnelStages),
      outcomes: Object.freeze(fullFunnelOutcomes),
    });
    const timeSeries = buildDashboardTimeSeries(overview, currentPeriod);
    const previousTimeSeries = buildDashboardTimeSeries(previousOverview, comparisonPeriod);

    const entityStageRows = leads.flatMap((lead) => [
      ...lead.stageHistory.map((history) => ({ leadId: lead.id, entityId: lead.id, key: leadKey(lead.id), history, entityType: "LEAD" as const })),
      ...lead.opportunities.flatMap((opportunity) => opportunity.stageHistory.map((history) => ({
        leadId: lead.id, entityId: opportunity.id, key: opportunityKey(opportunity.id), history, entityType: "OPPORTUNITY" as const,
      }))),
    ]);
    const enteredGroups = new Map<string, typeof entityStageRows>();
    for (const row of entityStageRows.filter((item) => item.history.enteredAt >= from && item.history.enteredAt < to)) {
      const key = `${row.history.pipelineId}:${row.history.stageId}:${row.entityType}`;
      const group = enteredGroups.get(key) ?? [];
      group.push(row);
      enteredGroups.set(key, group);
    }
    const orderedGroups = [...enteredGroups.values()].sort((left, right) =>
      left[0]!.history.pipeline.name.localeCompare(right[0]!.history.pipeline.name, "pt-BR")
      || left[0]!.history.stage.position - right[0]!.history.stage.position);
    const stageConversion = orderedGroups.map((group) => {
      const first = group[0]!;
      const samePipeline = orderedGroups.filter((candidate) => candidate[0]!.history.pipelineId === first.history.pipelineId && candidate[0]!.entityType === first.entityType);
      const position = samePipeline.findIndex((candidate) => candidate[0]!.history.stageId === first.history.stageId);
      const denominator = position > 0 ? new Set(samePipeline[position - 1]!.map((item) => item.entityId)).size : null;
      const keys = unique(group.map((item) => item.key));
      const value = keys.length;
      const id = `${first.entityType.toLowerCase()}.${first.history.stageId}`;
      return Object.freeze({
        id, label: `${first.history.pipeline.name} · ${first.history.stage.name}`, value, denominator,
        percentage: denominator === null ? null : percent(value, denominator), secondaryValue: null, secondaryLabel: null,
        drilldownId: addDrilldown(`stage-conversion.${id}`, `Entradas em ${first.history.stage.name}`, "Entidades que entraram na etapa durante o período.", denominator === null ? "entradas na etapa" : "entradas / etapa anterior", keys),
      });
    });

    const stageTime = overview.stageTime.map((metric) => {
      const keys = unique(entityStageRows
        .filter((row) => row.entityType === metric.entityType && row.history.pipelineId === metric.pipelineId && row.history.stageId === metric.stageId
          && row.history.enteredAt < to && (row.history.exitedAt === null || row.history.exitedAt > from))
        .map((row) => row.key));
      const id = `${metric.entityType.toLowerCase()}.${metric.stageId}`;
      return Object.freeze({
        id, label: `${metric.pipelineName} · ${metric.stageName}`, value: metric.statistics.sampleCount,
        denominator: null, percentage: null, secondaryValue: metric.statistics.averageSeconds,
        secondaryLabel: "tempo médio",
        drilldownId: addDrilldown(`stage-time.${id}`, `Tempo em ${metric.stageName}`, "Intervalos históricos sobrepostos ao período.", "interseção de StageHistory com o período", keys),
      });
    });

    const assignedByLead = new Map<string, { id: string; name: string }>();
    for (const lead of leads) {
      const cycle = cohort.has(lead.id) ? lead.slaCycles[0] : undefined;
      if (cycle?.assignedMember) assignedByLead.set(lead.id, { id: cycle.assignedMember.id, name: cycle.assignedMember.user.displayName });
    }
    const sdrGroups = new Map<string, { name: string; ids: Set<string> }>();
    for (const [leadId, member] of assignedByLead) {
      const group = sdrGroups.get(member.id) ?? { name: member.name, ids: new Set<string>() };
      group.ids.add(leadId); sdrGroups.set(member.id, group);
    }
    const sdrPerformance = [...sdrGroups.entries()].map(([id, group]) => {
      const attempts = [...group.ids].filter((leadId) => attempted.has(leadId)).length;
      return Object.freeze({
        id, label: group.name, value: group.ids.size, denominator: group.ids.size,
        percentage: percent(attempts, group.ids.size), secondaryValue: attempts, secondaryLabel: "tentativas",
        drilldownId: addDrilldown(`sdr.${id}`, `Leads de ${group.name}`, "Leads recebidos atribuídos ao SDR.", "leads recebidos por atribuição", [...group.ids].map(leadKey)),
      });
    }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));

    const closerGroups = new Map<string, { name: string; held: string[]; noShow: string[]; wins: string[]; revenue: bigint }>();
    for (const lead of leads) {
      const latest = new Map<string, (typeof lead.meetingHistory)[number]>();
      for (const history of lead.meetingHistory) {
        const current = latest.get(history.meetingId);
        if (!current || current.meetingRevision <= history.meetingRevision) latest.set(history.meetingId, history);
      }
      for (const meeting of latest.values()) {
        if (meeting.newStartsAt < from || meeting.newStartsAt >= to || !["COMPLETED", "NO_SHOW"].includes(meeting.newStatus)) continue;
        const group = closerGroups.get(meeting.owner.id) ?? { name: meeting.owner.user.displayName, held: [], noShow: [], wins: [], revenue: 0n };
        (meeting.newStatus === "COMPLETED" ? group.held : group.noShow).push(meetingKey(meeting.meetingId));
        closerGroups.set(meeting.owner.id, group);
      }
      for (const snapshot of lead.opportunityOutcomeSnapshots) {
        if (snapshot.status !== "WON" || snapshot.occurredAt < from || snapshot.occurredAt >= to
          || (snapshot.stageHistory.exitedAt !== null && snapshot.stageHistory.exitedAt < to)) continue;
        const opportunity = lead.opportunities.find((item) => item.id === snapshot.opportunityId);
        if (!opportunity) continue;
        const group = closerGroups.get(opportunity.owner.id) ?? { name: opportunity.owner.user.displayName, held: [], noShow: [], wins: [], revenue: 0n };
        group.wins.push(opportunityKey(opportunity.id)); group.revenue += snapshot.amountCents;
        closerGroups.set(opportunity.owner.id, group);
      }
    }
    const closerPerformance = [...closerGroups.entries()].map(([id, group]) => {
      const decided = group.held.length + group.noShow.length;
      return Object.freeze({
        id, label: group.name, value: group.held.length, denominator: decided,
        percentage: percent(group.held.length, decided), secondaryValue: group.revenue.toString(), secondaryLabel: "receita em centavos",
        drilldownId: addDrilldown(`closer.${id}`, `Reuniões de ${group.name}`, "Reuniões decididas do closer no período.", "shows / reuniões decididas", [...group.held, ...group.noShow]),
      });
    }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));

    const commercialFunctions = commercialMembers.flatMap((member) => {
      const explicit = [...new Set(member.teamMemberships.map((assignment) => assignment.function))];
      const fallback = commercialFunctionForRole(member.role.key);
      const functions = explicit.length > 0 ? explicit : fallback ? [fallback] : [];
      return functions.map((role) => ({
        id: member.id,
        name: member.user.displayName,
        role,
      }));
    });
    const sdrPerformanceRows: DashboardPerformanceRow[] = [...sdrGroups.entries()].map(([id, group]) => {
      const idsForMember = [...group.ids];
      const slaSamples = leads.flatMap((lead) => lead.slaCycles
        .filter((cycle) => cycle.assignedMember?.id === id && cycle.receivedAt >= from && cycle.receivedAt < to)
        .flatMap((cycle) => cycle.firstHumanAttemptSeconds === null ? [] : [cycle.firstHumanAttemptSeconds]));
      const revenue = overview.evidence.periodWins
        .filter((row) => group.ids.has(row.leadId))
        .reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
      const meetings = overview.evidence.scheduledMeetings.filter((row) => group.ids.has(row.leadId)).length;
      const qualifiedForMember = idsForMember.filter((leadId) => qualified.has(leadId)).length;
      return Object.freeze({
        id,
        name: group.name,
        role: "SDR" as const,
        volume: group.ids.size,
        conversionPercentage: percent(qualifiedForMember, group.ids.size),
        revenueCents: revenue.toString(),
        slaSeconds: slaSamples.length === 0
          ? null
          : Math.round(slaSamples.reduce((sum, value) => sum + value, 0) / slaSamples.length),
        meetings,
        showRate: null,
        drilldownId: `sdr.${id}`,
      });
    });
    for (const member of commercialFunctions.filter((item) => item.role === "SDR")) {
      if (sdrPerformanceRows.some((row) => row.id === member.id)) continue;
      sdrPerformanceRows.push(Object.freeze({
        id: member.id,
        name: member.name,
        role: "SDR" as const,
        volume: 0,
        conversionPercentage: null,
        revenueCents: "0",
        slaSeconds: null,
        meetings: 0,
        showRate: null,
        drilldownId: addDrilldown(
          `sdr.${member.id}`,
          `Leads de ${member.name}`,
          "Nenhum lead recebido por este SDR no período.",
          "leads recebidos por atribuição",
          [],
        ),
      }));
    }
    const closerIds = new Set([
      ...closerGroups.keys(),
      ...periodOpportunities.map(({ item }) => item.owner.id),
    ]);
    const closerPerformanceRows: DashboardPerformanceRow[] = [...closerIds].map((id) => {
      const group = closerGroups.get(id);
      const opportunitiesForCloser = periodOpportunities.filter(({ item }) => item.owner.id === id);
      const decided = (group?.held.length ?? 0) + (group?.noShow.length ?? 0);
      const name = group?.name ?? opportunitiesForCloser[0]?.item.owner.user.displayName ?? "Closer";
      const drilldownId = addDrilldown(
        `performance.closer.${id}`,
        `Performance de ${name}`,
        "Oportunidades, reuniões decididas e ganhos do closer no período.",
        "ganhos / oportunidades criadas; show / reuniões decididas",
        unique([
          ...opportunitiesForCloser.map(({ item }) => opportunityKey(item.id)),
          ...(group?.held ?? []),
          ...(group?.noShow ?? []),
        ]),
      );
      return Object.freeze({
        id,
        name,
        role: "CLOSER" as const,
        volume: opportunitiesForCloser.length,
        conversionPercentage: percent(group?.wins.length ?? 0, opportunitiesForCloser.length),
        revenueCents: (group?.revenue ?? 0n).toString(),
        slaSeconds: null,
        meetings: decided,
        showRate: percent(group?.held.length ?? 0, decided),
        drilldownId,
      });
    });
    for (const member of commercialFunctions.filter((item) => item.role === "CLOSER")) {
      if (closerPerformanceRows.some((row) => row.id === member.id)) continue;
      closerPerformanceRows.push(Object.freeze({
        id: member.id,
        name: member.name,
        role: "CLOSER" as const,
        volume: 0,
        conversionPercentage: null,
        revenueCents: "0",
        slaSeconds: null,
        meetings: 0,
        showRate: null,
        drilldownId: addDrilldown(
          `performance.closer.${member.id}`,
          `Performance de ${member.name}`,
          "Nenhuma oportunidade ou reunião decidida no período.",
          "ganhos / oportunidades criadas; show / reuniões decididas",
          [],
        ),
      }));
    }
    const performance = [...sdrPerformanceRows, ...closerPerformanceRows]
      .sort((left, right) => left.role.localeCompare(right.role) || right.volume - left.volume || left.name.localeCompare(right.name, "pt-BR"));

    const cohortLeads = leads.filter((lead) => cohort.has(lead.id));
    const dimension = (
      prefix: string,
      rows: readonly { id: string; label: string; leadId: string }[],
    ): DashboardSegment[] => {
      const groups = new Map<string, { label: string; ids: Set<string> }>();
      for (const row of rows) {
        const group = groups.get(row.id) ?? { label: row.label, ids: new Set<string>() };
        group.ids.add(row.leadId); groups.set(row.id, group);
      }
      return [...groups.entries()].map(([id, group]) => Object.freeze({
        id, label: group.label, value: group.ids.size, denominator: cohort.size,
        percentage: percent(group.ids.size, cohort.size), secondaryValue: null, secondaryLabel: null,
        drilldownId: addDrilldown(`${prefix}.${id}`, `${group.label} · leads recebidos`, "Distribuição dos leads recebidos no período.", "leads do segmento / leads recebidos", [...group.ids].map(leadKey)),
      })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));
    };
    const sourceSegments = dimension("source", cohortLeads.map((lead) => ({ id: lead.source.id, label: lead.source.name, leadId: lead.id })));
    const campaignSegments = dimension("campaign", cohortLeads.map((lead) => ({ id: lead.campaign?.id ?? "none", label: lead.campaign?.name ?? "Sem campanha", leadId: lead.id })));
    const creativeSegments = dimension("creative", cohortLeads.map((lead) => ({ id: lead.creative?.id ?? "none", label: lead.creative?.name ?? "Sem criativo", leadId: lead.id })));
    const prioritySegments = dimension("priority", cohortLeads.map((lead) => ({
      id: lead.scores[0]?.priorityBandCode ?? lead.slaCycles.at(-1)?.priorityBand.code ?? "none",
      label: lead.scores[0]?.priorityBandCode ?? lead.slaCycles.at(-1)?.priorityBand.code ?? "Sem prioridade",
      leadId: lead.id,
    })));
    const wonLeadIds = new Set(overview.evidence.periodWins.map((row) => row.leadId));
    const sourceConversion = sourceSegments.map((segment) => {
      const leadsFromSource = cohortLeads.filter((lead) => lead.source.id === segment.id);
      const won = leadsFromSource.filter((lead) => wonLeadIds.has(lead.id));
      return Object.freeze({
        id: segment.id,
        label: segment.label,
        value: won.length,
        denominator: leadsFromSource.length,
        percentage: percent(won.length, leadsFromSource.length),
        secondaryValue: leadsFromSource.length,
        secondaryLabel: "leads recebidos",
        drilldownId: addDrilldown(
          `source-conversion.${segment.id}`,
          `${segment.label} · conversão em venda`,
          "Leads recebidos desta origem e seus ganhos vigentes no corte.",
          "leads com ganho vigente / leads recebidos da origem",
          leadsFromSource.map((lead) => leadKey(lead.id)),
        ),
      });
    }).sort((left, right) => (right.percentage ?? -1) - (left.percentage ?? -1) || right.denominator - left.denominator);

    const disqualifiedRows = leads.filter((lead) => lead.disqualificationReason && lead.stageHistory.some((history) =>
      history.stage.leadStageCode === "DISQUALIFIED" && history.enteredAt >= from && history.enteredAt < to));
    const disqualificationReasons = dimension("disqualification", disqualifiedRows.map((lead) => ({
      id: lead.disqualificationReason!.id, label: lead.disqualificationReason!.name, leadId: lead.id,
    })));
    const activeLosses = leads.flatMap((lead) => lead.opportunityOutcomeSnapshots
      .filter((snapshot) => snapshot.status === "LOST" && snapshot.occurredAt >= from && snapshot.occurredAt < to
        && (snapshot.stageHistory.exitedAt === null || snapshot.stageHistory.exitedAt >= to))
      .map((snapshot) => ({ lead, snapshot })));
    const lossReasons = dimension("loss", activeLosses.map(({ lead, snapshot }) => ({
      id: snapshot.lossReason?.id ?? "none", label: snapshot.lossReason?.name ?? "Sem motivo", leadId: lead.id,
    })));
    const noShowRows = leads.flatMap((lead) => {
      const latest = new Map<string, (typeof lead.meetingHistory)[number]>();
      for (const history of lead.meetingHistory) {
        const current = latest.get(history.meetingId);
        if (!current || current.meetingRevision <= history.meetingRevision) latest.set(history.meetingId, history);
      }
      return [...latest.values()].filter((meeting) => meeting.newStatus === "NO_SHOW" && meeting.newStartsAt >= from && meeting.newStartsAt < to)
        .map((meeting) => ({ lead, meeting }));
    });
    const noShowReasonMap = new Map<string, { label: string; keys: string[] }>();
    for (const { meeting } of noShowRows) {
      const label = meeting.reason?.trim() || "Sem motivo informado";
      const id = label.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-");
      const group = noShowReasonMap.get(id) ?? { label, keys: [] };
      group.keys.push(meetingKey(meeting.meetingId)); noShowReasonMap.set(id, group);
    }
    const noShowReasons = [...noShowReasonMap.entries()].map(([id, group]) => Object.freeze({
      id, label: group.label, value: group.keys.length, denominator: noShowRows.length,
      percentage: percent(group.keys.length, noShowRows.length), secondaryValue: null, secondaryLabel: null,
      drilldownId: addDrilldown(`no-show.${id}`, `No-show · ${group.label}`, "Reuniões no-show agrupadas pelo motivo persistido.", "no-shows do motivo / total de no-shows", group.keys),
    }));

    const pactoRows = cohortLeads.map((lead) => {
      const qualification = lead.qualification;
      const validated = qualification?.assessments.filter((item) => item.validatedAt !== null && item.status !== "UNKNOWN").length ?? 0;
      if (!qualification || qualification.status === "NOT_STARTED") return { id: "not-started", label: "Não iniciado", leadId: lead.id };
      if (qualification.status === "COMPLETED" && validated >= qualification.minimumRequiredDimensions) return { id: "validated", label: "Validado e completo", leadId: lead.id };
      if (qualification.status === "COMPLETED") return { id: "validated-incomplete", label: "Validado incompleto", leadId: lead.id };
      return { id: "draft", label: "Em rascunho", leadId: lead.id };
    });
    const pactoQuality = dimension("pacto", pactoRows);

    const open = new Set(overview.evidence.openLeadIds);
    const openHistory = leads.flatMap((lead) => lead.stageHistory
      .filter((history) => open.has(lead.id) && history.enteredAt < to && (history.exitedAt === null || history.exitedAt >= to))
      .map((history) => ({ lead, history })));
    const backlogMap = new Map<string, { label: string; ids: Set<string>; seconds: number[] }>();
    for (const { lead, history } of openHistory) {
      const group = backlogMap.get(history.stageId) ?? { label: history.stage.name, ids: new Set<string>(), seconds: [] };
      group.ids.add(lead.id); group.seconds.push(durationSeconds(history.enteredAt, to)); backlogMap.set(history.stageId, group);
    }
    const backlogByStage = [...backlogMap.entries()].map(([id, group]) => Object.freeze({
      id, label: group.label, value: group.ids.size, denominator: open.size,
      percentage: percent(group.ids.size, open.size), secondaryValue: null, secondaryLabel: null,
      drilldownId: addDrilldown(`backlog.${id}`, `Backlog · ${group.label}`, "Leads em intervalo aberto nesta etapa no corte.", "leads da etapa / backlog", [...group.ids].map(leadKey)),
    })).sort((a, b) => b.value - a.value);
    const agingByStage = [...backlogMap.entries()].map(([id, group]) => {
      const average = group.seconds.length === 0 ? null : Math.round(group.seconds.reduce((sum, value) => sum + value, 0) / group.seconds.length);
      return Object.freeze({
        id, label: group.label, value: group.ids.size, denominator: null, percentage: null,
        secondaryValue: average, secondaryLabel: "aging médio",
        drilldownId: addDrilldown(`aging.${id}`, `Aging · ${group.label}`, "Leads e idade do intervalo aberto no corte.", "segundos desde a entrada na etapa", [...group.ids].map(leadKey)),
      });
    }).sort((a, b) => Number(b.secondaryValue ?? 0) - Number(a.secondaryValue ?? 0));

    const criticalSlaKeys = overview.evidence.slaCycles
      .filter((cycle) => cycle.humanSeconds !== null && cycle.humanSeconds > 180)
      .map((cycle) => slaKey(cycle.cycleId));
    const meetingsWithoutPactoKeys = leads.flatMap((lead) => {
      const qualification = lead.qualification;
      const validatedDimensions = qualification?.assessments
        .filter((item) => item.validatedAt !== null && item.status !== "UNKNOWN").length ?? 0;
      const pactoComplete = qualification?.status === "COMPLETED"
        && validatedDimensions >= qualification.minimumRequiredDimensions;
      if (pactoComplete) return [];
      const latest = new Map<string, (typeof lead.meetingHistory)[number]>();
      for (const history of lead.meetingHistory) {
        const current = latest.get(history.meetingId);
        if (!current || current.meetingRevision <= history.meetingRevision) latest.set(history.meetingId, history);
      }
      return [...latest.values()]
        .filter((meeting) => ["SCHEDULED", "CONFIRMED"].includes(meeting.newStatus)
          && meeting.newStartsAt >= from && meeting.newStartsAt < to)
        .map((meeting) => meetingKey(meeting.meetingId));
    });
    const opportunityCutoff = new Date(to.getTime() - workspaceSettings.leadStagnationDays * 86_400_000);
    const stalledOpportunityKeys = leads.flatMap((lead) => lead.opportunities
      .filter((opportunity) => {
        if (opportunity.status !== "OPEN") return false;
        const currentStage = opportunity.stageHistory.find((history) =>
          history.enteredAt < to && (history.exitedAt === null || history.exitedAt >= to));
        return currentStage !== undefined && currentStage.enteredAt <= opportunityCutoff;
      })
      .map((opportunity) => opportunityKey(opportunity.id)));
    const failedAutomationKeys = failedAutomationRuns.map((run) => automationRunKey(run.id));
    const attention: DashboardAttentionItem[] = [
      {
        id: "without-next-action", label: "Leads sem próxima ação",
        value: overview.leadsWithoutNextAction.value, severity: "CRITICAL",
        detail: "Erro operacional: backlog sem tarefa ativa no corte.",
        drilldownId: addDrilldown(
          "attention.without-next-action", "Leads sem próxima ação", "Backlog que exige definição explícita do próximo passo.",
          "leads abertos sem tarefa ativa no corte", overview.evidence.leadsWithoutNextActionIds.map(leadKey),
        ),
      },
      {
        id: "critical-sla", label: "SLA crítico",
        value: criticalSlaKeys.length, severity: "CRITICAL",
        detail: "Primeira tentativa humana acima de 180 segundos.",
        drilldownId: addDrilldown(
          "attention.critical-sla", "Ciclos com SLA crítico", "Entradas cuja primeira tentativa humana superou 180 segundos.",
          "firstHumanAttemptSeconds > 180", criticalSlaKeys,
        ),
      },
      {
        id: "stalled-leads", label: "Leads parados",
        value: overview.stalledLeads.value, severity: "WARNING",
        detail: `Backlog há pelo menos ${workspaceSettings.leadStagnationDays} dias na etapa.`,
        drilldownId: addDrilldown(
          "attention.stalled-leads", "Leads parados", "Leads acima do limite persistido de estagnação.",
          `backlog na etapa há pelo menos ${workspaceSettings.leadStagnationDays} dias`, overview.evidence.stalledLeadIds.map(leadKey),
        ),
      },
      {
        id: "meetings-without-pacto", label: "Reuniões sem PACTO",
        value: meetingsWithoutPactoKeys.length, severity: "WARNING",
        detail: "Reuniões ativas do período sem o mínimo humano validado.",
        drilldownId: addDrilldown(
          "attention.meetings-without-pacto", "Reuniões sem PACTO completo", "Reuniões ativas no período sem qualificação humana mínima.",
          "reunião SCHEDULED ou CONFIRMED e PACTO humano incompleto", meetingsWithoutPactoKeys,
        ),
      },
      {
        id: "stalled-opportunities", label: "Oportunidades paradas",
        value: stalledOpportunityKeys.length, severity: "WARNING",
        detail: `Oportunidades abertas há pelo menos ${workspaceSettings.leadStagnationDays} dias na etapa.`,
        drilldownId: addDrilldown(
          "attention.stalled-opportunities", "Oportunidades paradas", "Oportunidades abertas acima do limite persistido de estagnação.",
          `oportunidade OPEN na etapa há pelo menos ${workspaceSettings.leadStagnationDays} dias`, stalledOpportunityKeys,
        ),
      },
      {
        id: "no-show", label: "No-shows",
        value: noShowKeys.length, severity: "WARNING",
        detail: "Reuniões decididas sem comparecimento no período.",
        drilldownId: addDrilldown(
          "attention.no-show", "No-shows do período", "Reuniões cujo estado final no corte é NO_SHOW.",
          "reuniões NO_SHOW / reuniões decididas", noShowKeys,
        ),
      },
      {
        id: "automation-errors", label: "Automações com erro",
        value: failedAutomationKeys.length, severity: "INFO",
        detail: "Execuções com falha vinculadas aos leads autorizados.",
        drilldownId: addDrilldown(
          "attention.automation-errors", "Automações com erro", "Execuções FAILED no período e no universo autorizado.",
          "AutomationRun com status FAILED no período", failedAutomationKeys,
        ),
      },
    ];

    const dedupeOptions = (rows: readonly DashboardFilterOption[]) => optionSort(
      [...new Map(rows.map((row) => [row.id, row])).values()],
    );
    const filterOptions = Object.freeze({
      sdrs: dedupeOptions(commercialFunctions.filter((item) => item.role === "SDR").map((item) => ({ id: item.id, name: item.name }))),
      closers: dedupeOptions(commercialFunctions.filter((item) => item.role === "CLOSER").map((item) => ({ id: item.id, name: item.name }))),
      teams: dedupeOptions(teamMembers.map((item) => item.team)),
      sources: optionSort(sources), campaigns: optionSort(campaigns), creatives: optionSort(creatives), products: optionSort(products),
      priorities: Object.freeze([
        { id: "P1" as const, name: "P1 · alta" }, { id: "P2" as const, name: "P2 · média" }, { id: "P3" as const, name: "P3 · baixa" },
      ]),
    });

    return Object.freeze({
      query, comparisonPeriod, overview, integrated, kpis: Object.freeze(kpis),
      comparisons: Object.freeze(comparisons), timeSeries, previousTimeSeries,
      funnel: Object.freeze(funnel), fullFunnel, attention: Object.freeze(attention),
      stageConversion: Object.freeze(stageConversion), stageTime: Object.freeze(stageTime),
      sdrPerformance: Object.freeze(sdrPerformance), closerPerformance: Object.freeze(closerPerformance),
      performance: Object.freeze(performance),
      sources: Object.freeze(sourceSegments), sourceConversion: Object.freeze(sourceConversion), campaigns: Object.freeze(campaignSegments), creatives: Object.freeze(creativeSegments), priorities: Object.freeze(prioritySegments),
      disqualificationReasons: Object.freeze(disqualificationReasons), lossReasons: Object.freeze(lossReasons), noShowReasons: Object.freeze(noShowReasons),
      pactoQuality: Object.freeze(pactoQuality), backlogByStage: Object.freeze(backlogByStage), agingByStage: Object.freeze(agingByStage),
      filterOptions, records: Object.freeze([...records.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key))),
      drilldowns: Object.freeze([...drilldowns.values()]),
      hasData: cohort.size > 0 || periodOpportunities.length > 0 || heldKeys.length > 0 || noShowKeys.length > 0 || winKeys.length > 0 || open.size > 0,
    });
  }

  async function getDrilldown(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<DashboardDrilldownPage> {
    const parsed = drilldownSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const screen = await getScreen(context, input);
    const drilldown = screen.drilldowns.find((item) => item.id === parsed.data.view);
    if (!drilldown) invalidInput("Recorte de dashboard desconhecido.");
    const byKey = new Map(screen.records.map((record) => [record.key, record]));
    const allRecords = drilldown.recordKeys.flatMap((key) => {
      const record = byKey.get(key);
      return record ? [record] : [];
    }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key));
    const total = allRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / parsed.data.pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const start = (page - 1) * parsed.data.pageSize;
    return Object.freeze({
      generatedAt: screen.overview.generatedAt,
      query: screen.query,
      period: parsed.data.view.startsWith("comparison.previous.")
        ? screen.comparisonPeriod
        : periodInterval(screen.query, screen.overview.period.timeZone),
      timeZone: screen.overview.period.timeZone,
      drilldown: Object.freeze({ id: drilldown.id, title: drilldown.title, description: drilldown.description, formula: drilldown.formula }),
      records: Object.freeze(allRecords.slice(start, start + parsed.data.pageSize)),
      page, pageSize: parsed.data.pageSize, total, totalPages,
    });
  }

  return Object.freeze({ parseQuery, getScreen, getDrilldown });
}

let dashboardMetricsService: ReturnType<typeof createDashboardMetricsService> | undefined;

export function getDashboardMetricsService() {
  dashboardMetricsService ??= createDashboardMetricsService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return dashboardMetricsService;
}
