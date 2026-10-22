import type { PrismaClient } from "@/generated/prisma/client";

export async function readOteSdrOrigins(database: PrismaClient, workspaceId: string, memberId: string, at: Date) {
  const candidates = await database.commercialMetricFact.findMany({
    where: { workspaceId, reversedAt: null, occurredAt: { lte: at }, OR: [
      { eventType: "MEETING_SCHEDULED", bookedByMemberId: memberId },
      { eventType: "SALE_WON", originatingSdrMemberId: memberId },
    ] }, select: { eventType: true, leadId: true, opportunityId: true },
  });
  const bookings = await database.commercialMetricFact.findMany({
    where: { workspaceId, eventType: "MEETING_SCHEDULED", reversedAt: null, occurredAt: { lte: at }, leadId: { in: candidates.flatMap((f) => f.leadId ? [f.leadId] : []) } },
    select: { leadId: true, meetingId: true, bookedByMemberId: true, occurredAt: true }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  // Rescheduling does not create a second origin or move SDR credit to the closer.
  const leads = new Map<string, { memberId: string | null; at: Date }>();
  const meetings = new Map<string, string | null>();
  for (const fact of bookings) {
    if (fact.leadId && !leads.has(fact.leadId)) leads.set(fact.leadId, { memberId: fact.bookedByMemberId, at: fact.occurredAt });
    if (fact.meetingId && !meetings.has(fact.meetingId)) meetings.set(fact.meetingId, fact.bookedByMemberId);
  }
  return {
    leads: [...leads].flatMap(([leadId, origin]) => origin.memberId === memberId ? [{ leadId, at: origin.at }] : []),
    meetingIds: [...meetings].flatMap(([id, booker]) => booker === memberId ? [id] : []),
    saleIds: candidates.flatMap((f) => f.eventType === "SALE_WON" && f.opportunityId ? [f.opportunityId] : []),
  };
}
