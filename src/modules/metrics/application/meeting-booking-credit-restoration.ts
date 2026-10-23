import type { CommercialMetricFactInput } from "./commercial-metric-fact-writer";

type BookingFact = Pick<CommercialMetricFactInput,
  "workspaceId" | "eventKey" | "eventType" | "occurredAt" | "sourceEntityType" | "sourceEntityId"
  | "sourceRevision" | "meetingId" | "leadId" | "opportunityId" | "activityId"
  | "creditedMemberId" | "performedByMemberId" | "bookedByMemberId"
  | "leadOwnerMemberIdAtEvent" | "meetingOwnerMemberIdAtEvent" | "correctionOfFactId"
> & Readonly<{ id: string; quantity: number }>;

// Compensate the former EDIT bug without mutating the append-only ledger.
// Undo the erroneous debit in the same attribution bucket, leaving the original booking intact.
export function meetingBookingCreditRestoration(
  reversal: BookingFact,
  original: BookingFact,
): CommercialMetricFactInput | null {
  if (reversal.workspaceId !== original.workspaceId
    || reversal.eventType !== "MEETING_SCHEDULED" || original.eventType !== "MEETING_SCHEDULED"
    || reversal.sourceEntityType !== "MeetingHistory" || original.sourceEntityType !== "MeetingHistory"
    || reversal.quantity !== -original.quantity || original.quantity <= 0
    || reversal.correctionOfFactId !== original.id || original.correctionOfFactId
    || reversal.meetingId !== original.meetingId || !original.meetingId
    || reversal.sourceEntityId !== original.sourceEntityId
    || reversal.occurredAt.getTime() !== original.occurredAt.getTime()
    || !/:meeting-edit:[0-9a-f-]+:reversal:v1$/.test(reversal.eventKey)) return null;

  return {
    workspaceId: original.workspaceId,
    eventKey: `${reversal.eventKey}:booking-credit-restored:v1`,
    eventType: "MEETING_SCHEDULED",
    occurredAt: original.occurredAt,
    sourceEntityType: original.sourceEntityType,
    sourceEntityId: original.sourceEntityId,
    sourceRevision: original.sourceRevision ?? 1,
    meetingId: original.meetingId,
    leadId: original.leadId ?? null,
    opportunityId: original.opportunityId ?? null,
    activityId: reversal.activityId ?? null,
    creditedMemberId: reversal.creditedMemberId ?? null,
    performedByMemberId: reversal.performedByMemberId ?? null,
    bookedByMemberId: reversal.bookedByMemberId ?? null,
    leadOwnerMemberIdAtEvent: reversal.leadOwnerMemberIdAtEvent ?? null,
    meetingOwnerMemberIdAtEvent: reversal.meetingOwnerMemberIdAtEvent ?? null,
    quantity: original.quantity,
    executionMode: "SYSTEM",
    correctionOfFactId: reversal.id,
    reversalReason: "Restaura crédito de agendamento indevidamente estornado pela edição da reunião.",
    safeMetadata: { correction: "meeting_edit_booking_credit", originalFactId: original.id, erroneousReversalId: reversal.id },
  };
}
