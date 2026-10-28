import type { CommercialMetricFact, Prisma } from "@/generated/prisma/client";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "./commercial-metric-fact-writer";

// The card already earned the booking credit. Materializing its first calendar
// meeting must not earn a second one or move the original credit to another day.
export async function reconcileStageMeetingBookingInTransaction(
  transaction: Prisma.TransactionClient,
  booking: CommercialMetricFact,
) {
  if (booking.eventType !== "MEETING_SCHEDULED" || booking.sourceEntityType !== "MeetingHistory"
    || booking.quantity !== 1 || booking.correctionOfFactId || !booking.leadId || !booking.meetingId) return;
  const stage = await transaction.stageHistory.findFirst({
    where: {
      workspaceId: booking.workspaceId, leadId: booking.leadId,
      enteredAt: { lte: booking.occurredAt },
      OR: [{ exitedAt: null }, { exitedAt: { gt: booking.occurredAt } }],
      transitionOrigin: { not: "MEETING" }, stage: { leadStageCode: "MEETING_SCHEDULED" },
    },
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }], select: { id: true, enteredAt: true, pipeline: { select: { name: true } } },
  });
  if (!stage) return;
  const eventKey = `stage-history:${stage.id}:stage-booking-dedup:v1`;
  const prior = await transaction.commercialMetricFact.findUnique({
    where: { workspaceId_eventKey: { workspaceId: booking.workspaceId, eventKey } }, select: { id: true },
  });
  if (prior) return;
  const stageCredit = await transaction.commercialMetricFact.findUnique({
    where: { workspaceId_eventKey: { workspaceId: booking.workspaceId, eventKey: `stage-history:${stage.id}:meeting-scheduled:v1` } },
  });
  if (!stageCredit) return;
  const [balance, firstBooking] = await Promise.all([
    transaction.commercialMetricFact.aggregate({
      where: { workspaceId: booking.workspaceId, sourceEntityType: "StageHistory", sourceEntityId: stage.id, eventType: "MEETING_SCHEDULED" },
      _sum: { quantity: true },
    }),
    transaction.meetingHistory.findFirst({
      where: { workspaceId: booking.workspaceId, leadId: booking.leadId, action: "SCHEDULED", occurredAt: { gte: stage.enteredAt, lte: booking.occurredAt } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true },
    }),
  ]);
  if ((balance._sum.quantity ?? 0) <= 0 || firstBooking?.id !== booking.sourceEntityId) return;
  await recordCommercialMetricCorrectionInTransaction(transaction, {
    workspaceId: booking.workspaceId, eventKey, eventType: "MEETING_SCHEDULED",
    occurredAt: booking.occurredAt, sourceEntityType: booking.sourceEntityType,
    sourceEntityId: booking.sourceEntityId, sourceRevision: booking.sourceRevision,
    leadId: booking.leadId, meetingId: booking.meetingId, opportunityId: booking.opportunityId,
    activityId: booking.activityId, creditedMemberId: booking.creditedMemberId,
    performedByMemberId: booking.performedByMemberId, bookedByMemberId: booking.bookedByMemberId,
    leadOwnerMemberIdAtEvent: booking.leadOwnerMemberIdAtEvent,
    meetingOwnerMemberIdAtEvent: booking.meetingOwnerMemberIdAtEvent,
    quantity: -1, executionMode: "SYSTEM", correctionOfFactId: booking.id,
    reversalReason: "Agendamento já contabilizado pela entrada do card na etapa de reunião marcada.",
    safeMetadata: { correction: "stage_meeting_booking_dedup", stageHistoryId: stage.id, stageBookingFactId: stageCredit.id },
  });
  if (stage.pipeline.name === ADVERTISING_PIPELINE_NAME && (stageCredit.meetingId !== booking.meetingId || stageCredit.meetingOwnerMemberIdAtEvent !== booking.meetingOwnerMemberIdAtEvent)) {
    const original = {
      workspaceId: stageCredit.workspaceId, eventType: stageCredit.eventType, occurredAt: stageCredit.occurredAt,
      sourceEntityType: stageCredit.sourceEntityType, sourceEntityId: stageCredit.sourceEntityId, sourceRevision: stageCredit.sourceRevision,
      leadId: stageCredit.leadId, activityId: stageCredit.activityId, pipelineId: stageCredit.pipelineId, stageId: stageCredit.stageId,
      creditedMemberId: stageCredit.creditedMemberId, performedByMemberId: stageCredit.performedByMemberId, bookedByMemberId: stageCredit.bookedByMemberId,
      leadOwnerMemberIdAtEvent: stageCredit.leadOwnerMemberIdAtEvent, executionMode: stageCredit.executionMode, result: stageCredit.result,
    };
    await recordCommercialMetricCorrectionInTransaction(transaction, {
      ...original, eventKey: `${stageCredit.eventKey}:meeting-assignment:reversal:v1`, quantity: -stageCredit.quantity,
      meetingId: stageCredit.meetingId, meetingOwnerMemberIdAtEvent: stageCredit.meetingOwnerMemberIdAtEvent,
      correctionOfFactId: stageCredit.id, reversedAt: booking.occurredAt, reversalReason: "Responsável confirmado pela reunião vinculada, preservando data e crédito do agendamento do card.",
    });
    await recordCommercialMetricFactInTransaction(transaction, {
      ...original, eventKey: `${stageCredit.eventKey}:meeting-assignment:replacement:v1`, quantity: stageCredit.quantity,
      meetingId: booking.meetingId, meetingOwnerMemberIdAtEvent: booking.meetingOwnerMemberIdAtEvent,
      safeMetadata: { assignmentBasis: "linked_calendar_meeting", stageBookingFactId: stageCredit.id },
    });
  }
}
