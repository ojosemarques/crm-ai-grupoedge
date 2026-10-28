import type { RealtimeActivityFact } from "../domain/realtime-advertising-metrics";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { commercialFrontPipelineIds } from "@/modules/metrics/domain/commercial-front";
import { realtimeDashboardEventTypes } from "../domain/realtime-dashboard-domain";
import { realtimeFactPipelineId, type RealtimeDashboardFront } from "../domain/realtime-dashboard-front";
import { advertisingMessageActivities } from "./realtime-advertising-activities";

export type RealtimeFactScope = Readonly<{ where: Prisma.CommercialMetricFactWhereInput; leadWhere: Prisma.LeadWhereInput; memberIds: readonly string[] | null }>;

export async function readRealtimeDashboardFacts(database: PrismaClient, workspaceId: string, from: Date, to: Date, front: RealtimeDashboardFront, scope?: RealtimeFactScope) {
  const [allFactRows, pipelines] = await Promise.all([
    database.commercialMetricFact.findMany({
        where: {
          workspaceId,
          eventType: { in: [...realtimeDashboardEventTypes, ...(front === "ADVERTISING" ? ["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"] as const : [])] },
          occurredAt: { gte: from, lt: to },
          AND: [
            ...(scope ? [scope.where] : []),
            { NOT: { eventKey: { endsWith: ":front-classification:reversal:v1" } } },
            { corrections: { none: { eventKey: { endsWith: ":front-classification:replacement:v1" } } } },
          ],
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventType: true,
          sourceEntityType: true,
          activityId: true,
          pipelineId: true,
          safeMetadata: true,
          correctionSource: { select: { pipelineId: true, safeMetadata: true } },
          occurredAt: true,
          recordedAt: true,
          leadId: true,
          creditedMemberId: true,
          performedByMemberId: true,
          bookedByMemberId: true,
          meetingId: true,
          meetingOwnerMemberIdAtEvent: true,
          taskKind: true,
          result: true,
          cadenceStepKey: true,
          quantity: true,
          valueCents: true,
        },
      }),
    database.pipeline.findMany({ where: { workspaceId, entityType: "LEAD", deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const selectedPipelineIds = new Set(commercialFrontPipelineIds(front, pipelines));
  const knownPipelineIds = new Set(commercialFrontPipelineIds("ALL", pipelines));
  const manualMessages = front === "ADVERTISING" ? await advertisingMessageActivities(database, workspaceId, from, to, selectedPipelineIds,
    new Set(allFactRows.filter(fact => ["WHATSAPP_MESSAGE_SENT", "INSTAGRAM_MESSAGE_SENT"].includes(fact.eventType)).flatMap(fact => fact.activityId ? [fact.activityId] : [])), scope?.leadWhere) : [];
  return {
    factRows: [...allFactRows.filter(fact => selectedPipelineIds.has(realtimeFactPipelineId(fact) ?? "")), ...manualMessages],
    unclassified: allFactRows.filter(fact => !knownPipelineIds.has(realtimeFactPipelineId(fact) ?? "")).length,
  };
}

export function realtimeActivityFact(row: Awaited<ReturnType<typeof readRealtimeDashboardFacts>>["factRows"][number]): RealtimeActivityFact {
  return Object.freeze({ ...row, occurredAt: row.occurredAt.toISOString(), valueCents: row.valueCents?.toString() ?? null });
}
