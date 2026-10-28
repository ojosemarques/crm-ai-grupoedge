import type { Prisma } from "@/generated/prisma/client";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "./commercial-metric-fact-writer";

export async function findLeadMeetingCycle(database: Pick<Prisma.TransactionClient, "stageHistory" | "meeting">, workspaceId: string, leadId: string, at: Date) {
  const cycle = await database.stageHistory.findFirst({
    where: { workspaceId, leadId, opportunityId: null, enteredAt: { lte: at }, stage: { leadStageCode: "MEETING_SCHEDULED" } },
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }], select: { id: true, enteredAt: true },
  });
  const meeting = await database.meeting.findFirst({
    where: { workspaceId, leadId, deletedAt: null, ...(cycle ? { history: { some: { occurredAt: { gte: new Date(cycle.enteredAt.getTime() - 1) } } } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { cycle, meeting };
}

// A card without a calendar meeting still records a confirmed business outcome.
// Returning to the same stage is not another meeting; a new booking opens a cycle.
export async function recordStageMeetingOutcomeInTransaction(transaction: Prisma.TransactionClient, input: Readonly<{
  workspaceId: string; leadId: string; pipelineId: string; stageId: string; stageHistoryId: string; activityId: string;
  eventType: "MEETING_COMPLETED" | "MEETING_NO_SHOW"; occurredAt: Date; ownerMemberId: string | null; performedByMemberId: string | null; reason: string;
}>) {
  const { cycle, meeting } = await findLeadMeetingCycle(transaction, input.workspaceId, input.leadId, input.occurredAt);
  if (meeting) {
    const known = await transaction.commercialMetricFact.aggregate({ where: { workspaceId: input.workspaceId, meetingId: meeting.id, eventType: input.eventType }, _sum: { quantity: true } });
    if ((known._sum.quantity ?? 0) > 0) return;
  }
  const facts = await transaction.commercialMetricFact.findMany({
    where: { workspaceId: input.workspaceId, leadId: input.leadId, sourceEntityType: { in: ["StageHistory", "Activity"] }, eventType: { in: ["MEETING_COMPLETED", "MEETING_NO_SHOW"] }, ...(cycle ? { occurredAt: { gte: cycle.enteredAt } } : {}) },
  });
  const current = facts.find(fact => !fact.correctionOfFactId && fact.quantity + facts.filter(row => row.correctionOfFactId === fact.id).reduce((sum, row) => sum + row.quantity, 0) > 0);
  if (current?.eventType === input.eventType) return;
  if (current) await recordCommercialMetricCorrectionInTransaction(transaction, {
    workspaceId: input.workspaceId, eventKey: `${current.eventKey}:stage-outcome:${input.stageHistoryId}:reversal:v1`, eventType: current.eventType,
    occurredAt: current.occurredAt, sourceEntityType: current.sourceEntityType, sourceEntityId: current.sourceEntityId,
    leadId: input.leadId, activityId: input.activityId, pipelineId: current.pipelineId, stageId: current.stageId,
    creditedMemberId: current.creditedMemberId, performedByMemberId: input.performedByMemberId,
    leadOwnerMemberIdAtEvent: current.leadOwnerMemberIdAtEvent, meetingOwnerMemberIdAtEvent: current.meetingOwnerMemberIdAtEvent,
    quantity: -current.quantity, correctionOfFactId: current.id, reversedAt: input.occurredAt, reversalReason: input.reason, executionMode: "MANUAL",
  });
  await recordCommercialMetricFactInTransaction(transaction, {
    workspaceId: input.workspaceId, eventKey: `stage-history:${input.stageHistoryId}:${input.eventType.toLowerCase()}:v1`, eventType: input.eventType,
    occurredAt: input.occurredAt, sourceEntityType: "StageHistory", sourceEntityId: input.stageHistoryId, leadId: input.leadId,
    activityId: input.activityId, pipelineId: input.pipelineId, stageId: input.stageId, creditedMemberId: input.ownerMemberId ?? input.performedByMemberId,
    performedByMemberId: input.performedByMemberId, leadOwnerMemberIdAtEvent: input.ownerMemberId, meetingOwnerMemberIdAtEvent: input.ownerMemberId,
    result: input.eventType === "MEETING_COMPLETED" ? "COMPLETED" : "NO_SHOW", executionMode: "MANUAL",
    safeMetadata: { outcomeBasis: "lead_stage_entry", ...(cycle ? { bookingStageHistoryId: cycle.id } : {}) },
  });
}
