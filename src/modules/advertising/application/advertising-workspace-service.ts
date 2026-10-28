import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import { Prisma, type CommercialMetricEventType, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  leadVisibilityWhere,
  resolveLeadVisibilityScope,
} from "@/modules/leads/application/lead-list-service";
import { responsesByLead } from "@/modules/marketing-forms/application/marketing-form-response-summary-service";
import {
  prospectingMetricsPeriodPresets,
  resolveProspectingMetricsPeriod,
} from "@/modules/prospecting/domain/prospecting-metrics-period";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt } from "@/shared/core/time/workspace-time";
import { z } from "zod";

const querySchema = z.object({
  pipelineId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1),
  activityPage: z.coerce.number().int().positive().default(1),
  metricsPreset: z.enum(prospectingMetricsPeriodPresets).catch("LAST_30_DAYS").default("LAST_30_DAYS"),
  metricsFrom: z.string().optional(),
  metricsTo: z.string().optional(),
}).strict();

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;

function invalidInput(message: string): never {
  throw new ApplicationError(message, { code: "INVALID_INPUT", statusCode: 400, expose: true });
}

function sumQuantity(rows: readonly Readonly<{ eventType: CommercialMetricEventType; _sum: { quantity: number | null } }>[], eventType: CommercialMetricEventType) {
  return rows
    .filter((row) => row.eventType === eventType)
    .reduce((total, row) => total + (row._sum.quantity ?? 0), 0);
}

export function createAdvertisingWorkspaceService(options: Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>) {
  async function getScreen(context: AuthenticatedContext, raw: unknown) {
    const query = querySchema.parse(raw);
    const [pipeline, workspace, visibility] = await Promise.all([
      options.database.pipeline.findFirst({
        where: {
          id: query.pipelineId,
          workspaceId: context.workspaceId,
          entityType: "LEAD",
          name: ADVERTISING_PIPELINE_NAME,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          stages: {
            where: { deletedAt: null },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            select: { id: true, name: true, position: true, type: true, leadStageCode: true },
          },
        },
      }),
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      resolveLeadVisibilityScope(options.database, options.authorization, context, PermissionKeys.LEADS_READ),
    ]);
    if (!pipeline) invalidInput("O pipeline de Anúncios não pertence a este workspace.");

    const now = options.now();
    const period = resolveProspectingMetricsPeriod(
      query.metricsPreset,
      query.metricsFrom,
      query.metricsTo,
      now,
      workspace.timeZone,
    );
    const visibilityWhere = leadVisibilityWhere(context, visibility);
    const leadWhere = {
      workspaceId: context.workspaceId,
      pipelineId: pipeline.id,
      deletedAt: null,
      AND: [visibilityWhere],
    } satisfies Prisma.LeadWhereInput;
    const pageSize = 25;
    const activityPageSize = 25;

    const [leadTotal, stageCounts, leads, taskTotal, tasks] = await Promise.all([
      options.database.lead.count({ where: leadWhere }),
      options.database.lead.groupBy({ by: ["currentStageId"], where: leadWhere, _count: { _all: true } }),
      options.database.lead.findMany({
        where: leadWhere,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          normalizedPhone: true,
          jobTitle: true,
          organizationName: true,
          stateCode: true,
          status: true,
          priority: true,
          createdAt: true,
          currentStage: { select: { name: true } },
          owner: { select: { id: true, user: { select: { displayName: true } } } },
        },
      }),
      options.database.task.count({
        where: { workspaceId: context.workspaceId, deletedAt: null, lead: leadWhere },
      }),
      options.database.task.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null, lead: leadWhere },
        orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: (query.activityPage - 1) * activityPageSize,
        take: activityPageSize,
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          result: true,
          dueAt: true,
          completedAt: true,
          lead: { select: { id: true, fullName: true } },
          assignee: { select: { id: true, user: { select: { displayName: true } } } },
        },
      }),
    ]);
    const formResponses = await responsesByLead(options.database, context.workspaceId, leads.map((lead) => lead.id));

    const metricRows = await createMetricsService(options).getIntegratedProduction(context, {
      from: period.start.toISOString(), to: new Date(period.end.getTime() + 1).toISOString(),
      filters: { pipelineIds: [pipeline.id] },
    });
    const memberIds = [...new Set(metricRows.flatMap((row) => row.creditedMemberId ? [row.creditedMemberId] : []))];
    const members = memberIds.length
      ? await options.database.workspaceMember.findMany({
          where: { workspaceId: context.workspaceId, id: { in: memberIds } },
          select: { id: true, user: { select: { displayName: true } } },
        })
      : [];
    const memberNames = new Map(members.map((member) => [member.id, member.user.displayName]));
    const totals = {
      leadsReceived: sumQuantity(metricRows, "LEAD_CREATED"),
      calls: sumQuantity(metricRows, "CALL_ATTEMPTED"),
      callsConnected: sumQuantity(metricRows, "CALL_CONNECTED"),
      callsUnanswered: sumQuantity(metricRows, "CALL_UNANSWERED"),
      callsFailed: sumQuantity(metricRows, "CALL_FAILED"),
      whatsappSent: sumQuantity(metricRows, "WHATSAPP_MESSAGE_SENT"),
      whatsappUnavailable: sumQuantity(metricRows, "WHATSAPP_UNAVAILABLE"),
      instagramMessages: sumQuantity(metricRows, "INSTAGRAM_MESSAGE_SENT"),
      instagramFollows: sumQuantity(metricRows, "INSTAGRAM_FOLLOW_COMPLETED"),
      meetingsScheduled: sumQuantity(metricRows, "MEETING_SCHEDULED"),
      meetingsCompleted: sumQuantity(metricRows, "MEETING_COMPLETED"),
      proposals: sumQuantity(metricRows, "PROPOSAL_REACHED"),
      sales: sumQuantity(metricRows, "SALE_WON"),
      revenueCents: metricRows
        .filter((row) => row.eventType === "SALE_WON")
        .reduce((total, row) => total + (row._sum.valueCents ?? 0n), 0n),
    };

    return Object.freeze({
      generatedAt: now.toISOString(),
      today: workspaceDateAt(now, workspace.timeZone),
      timeZone: workspace.timeZone,
      pipeline: {
        id: pipeline.id,
        name: pipeline.name,
        total: leadTotal,
        stages: pipeline.stages.map((stage) => ({
          ...stage,
          leads: stageCounts.find((count) => count.currentStageId === stage.id)?._count._all ?? 0,
        })),
      },
      stock: {
        total: leadTotal,
        page: query.page,
        pageSize,
        items: leads.map((lead) => ({
          ...lead,
          phone: formResponses.get(lead.id)?.[0]?.phone ?? lead.normalizedPhone,
          formResponses: formResponses.get(lead.id) ?? [],
          createdAt: lead.createdAt.toISOString(),
          owner: lead.owner ? { id: lead.owner.id, name: lead.owner.user.displayName } : null,
        })),
      },
      activities: {
        total: taskTotal,
        page: query.activityPage,
        pageSize: activityPageSize,
        items: tasks.map((task) => ({
          ...task,
          dueAt: task.dueAt.toISOString(),
          completedAt: task.completedAt?.toISOString() ?? null,
          assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.user.displayName } : null,
        })),
      },
      metrics: {
        period: {
          preset: period.preset,
          fromDate: period.fromDate,
          toDate: period.toDate,
          timeZone: period.timeZone,
        },
        totals: { ...totals, revenueCents: totals.revenueCents.toString() },
        bySeller: memberIds.map((memberId) => {
          const rows = metricRows.filter((row) => row.creditedMemberId === memberId);
          return {
            memberId,
            memberName: memberNames.get(memberId) ?? "Membro indisponível",
            leadsReceived: sumQuantity(rows, "LEAD_CREATED"),
            calls: sumQuantity(rows, "CALL_ATTEMPTED"),
            callsConnected: sumQuantity(rows, "CALL_CONNECTED"),
            whatsappSent: sumQuantity(rows, "WHATSAPP_MESSAGE_SENT"),
            instagramMessages: sumQuantity(rows, "INSTAGRAM_MESSAGE_SENT"),
            instagramFollows: sumQuantity(rows, "INSTAGRAM_FOLLOW_COMPLETED"),
            meetingsScheduled: sumQuantity(rows, "MEETING_SCHEDULED"),
            meetingsCompleted: sumQuantity(rows, "MEETING_COMPLETED"),
            proposals: sumQuantity(rows, "PROPOSAL_REACHED"),
            sales: sumQuantity(rows, "SALE_WON"),
          };
        }).sort((left, right) => left.memberName.localeCompare(right.memberName, "pt-BR")),
      },
    });
  }

  return Object.freeze({ getScreen });
}

let singleton: ReturnType<typeof createAdvertisingWorkspaceService> | undefined;

export function getAdvertisingWorkspaceService() {
  singleton ??= createAdvertisingWorkspaceService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return singleton;
}
