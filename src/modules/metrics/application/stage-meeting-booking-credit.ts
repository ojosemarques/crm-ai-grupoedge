import type { CommercialMetricFact, Prisma } from "@/generated/prisma/client";
import { recordCommercialMetricCorrectionInTransaction } from "./commercial-metric-fact-writer";

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
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }], select: { id: true, enteredAt: true },
  });
  if (!stage) return;
  const eventKey = `stage-history:${stage.id}:stage-booking-dedup:v1`;
  const prior = await transaction.commercialMetricFact.findUnique({
    where: { workspaceId_eventKey: { workspaceId: booking.workspaceId, eventKey } }, select: { id: true },
  });
  if (prior) return;
  const stageCredit = await transaction.commercialMetricFact.findUnique({
    where: { workspaceId_eventKey: { workspaceId: booking.workspaceId, eventKey: `stage-history:${stage.id}:meeting-scheduled:v1` } },
    select: { id: true },
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
}
