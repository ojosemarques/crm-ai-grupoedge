import type { Prisma } from "@/generated/prisma/client";
import { projectSdrAdvertisingCohorts } from "@/modules/finance/domain/sdr-advertising-attainment";
import { readRealtimeDashboardFacts } from "@/modules/realtime-dashboard/application/realtime-dashboard-facts";

const arrivalEvents = ["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"] as const;

export async function readSdrAdvertisingFacts(tx: Prisma.TransactionClient, input: {
  workspaceId: string;
  memberId: string;
  from: Date;
  to: Date;
  through: Date;
  recordedThrough?: Date;
}) {
  const { workspaceId, memberId, from, to, through } = input;
  const recordedThrough = input.recordedThrough ?? through;
  const before = new Date(Math.min(to.getTime(), through.getTime() + 1));
  const scheduled = { gte: from, lt: before };
  const effectiveHistory = { occurredAt: { lte: recordedThrough }, createdAt: { lte: recordedThrough } };
  const scope = { where: {}, leadWhere: {}, memberIds: null, recordedThrough };
  const [periodArrivals, meetings] = await Promise.all([
    readRealtimeDashboardFacts(tx, workspaceId, from, before, "ADVERTISING", scope, arrivalEvents),
    tx.meeting.findMany({
      where: { workspaceId, deletedAt: null, OR: [
        { startsAt: scheduled, createdAt: { lte: recordedThrough } },
        { history: { some: { ...effectiveHistory, newStartsAt: scheduled } } },
      ] },
      select: { id: true, leadId: true, history: {
        where: effectiveHistory, orderBy: { meetingRevision: "asc" },
        select: { id: true, newStartsAt: true, newStatus: true, previousStatus: true, occurredAt: true },
      } },
    }),
  ]);
  const leadIds = [...new Set([
    ...periodArrivals.factRows.flatMap((fact) => fact.leadId ? [fact.leadId] : []),
    ...meetings.map((meeting) => meeting.leadId),
  ])];
  const meetingIds = meetings.map((meeting) => meeting.id);
  const historyStart = new Date(0);
  const [arrivalsHistory, bookingCredits, meetingBookings, assignments] = await Promise.all([
    readRealtimeDashboardFacts(tx, workspaceId, historyStart, before, "ADVERTISING",
      { ...scope, where: { leadId: { in: leadIds } } }, arrivalEvents),
    readRealtimeDashboardFacts(tx, workspaceId, from, before, "ADVERTISING",
      { ...scope, where: { leadId: { in: leadIds } } }, ["MEETING_SCHEDULED"]),
    readRealtimeDashboardFacts(tx, workspaceId, historyStart, new Date(through.getTime() + 1), "ADVERTISING",
      { ...scope, where: { meetingId: { in: meetingIds } }, preserveMeetingBookings: true }, ["MEETING_SCHEDULED"]),
    tx.leadAssignment.findMany({
      where: { workspaceId, leadId: { in: leadIds }, assignedAt: { lte: through }, createdAt: { lte: recordedThrough } },
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
      select: { leadId: true, assignedAt: true, toMemberId: true },
    }),
  ]);
  const arrivalCorrections = await tx.commercialMetricFact.groupBy({
    by: ["correctionOfFactId"],
    where: {
      workspaceId, quantity: { lt: 0 }, recordedAt: { lte: recordedThrough },
      correctionOfFactId: { in: arrivalsHistory.factRows.map((fact) => fact.id) },
    },
    _sum: { quantity: true },
  });
  const reversals = new Map(arrivalCorrections.map((row) => [row.correctionOfFactId, row._sum.quantity ?? 0]));
  const firstArrival = new Map<string, typeof arrivalsHistory.factRows[number]>();
  for (const fact of arrivalsHistory.factRows) {
    if (fact.leadId && fact.quantity + (reversals.get(fact.id) ?? 0) > 0 && !firstArrival.has(fact.leadId)) firstArrival.set(fact.leadId, fact);
  }
  const arrivals: { leadId: string; arrivedAt: Date }[] = [];
  const missing = new Set<string>();
  const arrivalOwners = new Map<string, string | null>();
  const assignmentsByLead = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const history = assignmentsByLead.get(assignment.leadId) ?? [];
    history.push(assignment);
    assignmentsByLead.set(assignment.leadId, history);
  }
  for (const [leadId, fact] of firstArrival) {
    const currentSnapshot = [fact.safeMetadata, fact.correctionSource?.safeMetadata].some((metadata) =>
      metadata && typeof metadata === "object" && "ownerBasis" in metadata && metadata.ownerBasis === "current_snapshot");
    const snapshotOwner = !currentSnapshot && "leadOwnerMemberIdAtEvent" in fact ? fact.leadOwnerMemberIdAtEvent : null;
    const assignedTo = snapshotOwner ?? assignmentsByLead.get(leadId)?.find((assignment) =>
      assignment.assignedAt <= fact.occurredAt)?.toMemberId ?? null;
    arrivalOwners.set(leadId, assignedTo);
    if (fact.occurredAt < from || fact.occurredAt >= before) continue;
    if (!assignedTo) missing.add(`arrival:${leadId}`);
    if (assignedTo === memberId) arrivals.push({ leadId, arrivedAt: fact.occurredAt });
  }
  const arrivalIds = new Set(arrivals.map((arrival) => arrival.leadId));
  const bookings = bookingCredits.factRows.flatMap((fact) => {
    if (!fact.leadId || !arrivalIds.has(fact.leadId) || fact.quantity <= 0) return [];
    if (!fact.bookedByMemberId) missing.add(`booking:${fact.leadId}`);
    return fact.bookedByMemberId === memberId ? [{ leadId: fact.leadId, bookedAt: fact.occurredAt }] : [];
  });

  const bookers = new Map<string, { memberId: string | null; direct: boolean }>();
  for (const fact of meetingBookings.factRows) {
    if (!fact.meetingId || fact.quantity <= 0) continue;
    const direct = fact.sourceEntityType === "MeetingHistory";
    const prior = bookers.get(fact.meetingId);
    if (!prior || (direct && !prior.direct)) bookers.set(fact.meetingId, { memberId: fact.bookedByMemberId, direct });
  }
  const occurrences = meetings.flatMap((meeting) => {
    const latest = meeting.history.at(-1);
    const owner = bookers.get(meeting.id);
    const arrival = firstArrival.get(meeting.leadId);
    const advertising = owner || arrival;
    if (!advertising || (owner?.memberId && owner.memberId !== memberId)) return [];
    if (latest && (latest.newStartsAt < from || latest.newStartsAt >= before)) return [];
    const cancelledAt = latest?.newStatus === "CANCELLED" ? [...meeting.history].reverse().find((entry) =>
      entry.newStatus === "CANCELLED" && entry.previousStatus !== "CANCELLED")?.occurredAt ?? null : null;
    if (latest && cancelledAt && cancelledAt < latest.newStartsAt) return [];
    const arrivalOwner = arrivalOwners.get(meeting.leadId);
    if (!owner?.memberId && arrivalOwner && arrivalOwner !== memberId) return [];
    if (!latest || !owner?.memberId) {
      missing.add(`meeting:${meeting.id}`);
      return [];
    }
    const outcome = latest.newStatus === "COMPLETED" ? "HELD" : latest.newStatus === "NO_SHOW" ? "NO_SHOW"
      : latest.newStatus === "CANCELLED" ? "CANCELLED" : "PENDING";
    return [{
      chainId: meeting.id, occurrenceId: latest.id, recordedAt: latest.occurredAt,
      scheduledAt: latest.newStartsAt, outcome, cancelledAt,
    }] as const;
  });

  const missingEvidence = missing.size + periodArrivals.unclassified + meetingBookings.unclassified;
  return {
    ...projectSdrAdvertisingCohorts({ from, to, through, recordedThrough, arrivals, bookings, meetings: occurrences, missingEvidence }),
    missingKeys: [...missing].sort(),
  };
}
