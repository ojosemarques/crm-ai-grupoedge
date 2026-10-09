import type { ActivityDirection, ActivityResult, ActivityType, CommercialMetricFact } from "@/generated/prisma/client";
import type { CommercialMetricFactInput } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { manualActivityMetricCorrection } from "@/modules/metrics/domain/manual-activity-metric-events";

export type ManualActivityFactBasis = Partial<Pick<CommercialMetricFact, "id">> & Pick<CommercialMetricFact,
  "eventKey" | "leadId" | "opportunityId" | "meetingId" | "creditedMemberId" | "performedByMemberId" |
  "leadOwnerMemberIdAtEvent" | "sourceId" | "campaignId" | "creativeId" | "pipelineId" | "stageId" |
  "teamId" | "direction" | "activityType" | "executionMode"
>;

export function manualActivityCorrectionFacts(input: Readonly<{
  workspaceId: string;
  originalId: string;
  correctionId: string;
  originalOccurredAt: Date;
  correctionOccurredAt: Date;
  reason: string;
  type: ActivityType;
  direction: ActivityDirection;
  previousResult: ActivityResult | null;
  correctedResult: ActivityResult | null;
  originalFacts: readonly ManualActivityFactBasis[];
}>): CommercialMetricFactInput[] {
  return manualActivityMetricCorrection(input.type, input.direction, input.previousResult, input.correctedResult).map(({ event, quantity, action, result }) => {
    const matchedBasis = input.originalFacts.find((fact) => fact.eventKey === `activity:${input.originalId}:${event.eventKeySuffix}:v1`);
    const basis = matchedBasis ?? input.originalFacts[0];
    if (!basis) throw new Error("O fato original da atividade corrigida não foi registrado.");
    return {
      workspaceId: input.workspaceId,
      eventKey: `activity:${input.correctionId}:${event.eventKeySuffix}:${action}:v1`,
      eventType: event.eventType,
      occurredAt: input.originalOccurredAt,
      sourceEntityType: "Activity",
      sourceEntityId: input.correctionId,
      activityId: input.correctionId,
      leadId: basis.leadId,
      opportunityId: basis.opportunityId,
      meetingId: basis.meetingId,
      creditedMemberId: basis.creditedMemberId,
      performedByMemberId: basis.performedByMemberId,
      leadOwnerMemberIdAtEvent: basis.leadOwnerMemberIdAtEvent,
      sourceId: basis.sourceId,
      campaignId: basis.campaignId,
      creativeId: basis.creativeId,
      pipelineId: basis.pipelineId,
      stageId: basis.stageId,
      teamId: basis.teamId,
      direction: basis.direction,
      channel: event.channel,
      activityType: basis.activityType,
      executionMode: basis.executionMode,
      result,
      quantity,
      ...(action === "reversed" && matchedBasis?.id ? {
        correctionOfFactId: matchedBasis.id, reversedAt: input.correctionOccurredAt, reversalReason: input.reason,
      } : {}),
      safeMetadata: { correctsActivityId: input.originalId },
    };
  });
}
