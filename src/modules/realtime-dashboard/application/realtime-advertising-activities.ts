import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Manual MESSAGE_SENT logs do not always have a channel metric fact. Read only
// those missing contributions; existing task/provider facts keep their identity.
export async function advertisingMessageActivities(database: PrismaClient, workspaceId: string, from: Date, to: Date, pipelineIds: ReadonlySet<string>, factActivityIds: ReadonlySet<string>, leadWhere?: Prisma.LeadWhereInput) {
  const activities = await database.activity.findMany({
    where: { workspaceId, ...(leadWhere ? { lead: leadWhere } : {}), type: "MESSAGE_SENT", direction: "OUTBOUND", result: "SENT", deletedAt: null, correctsActivityId: null, messageId: null, occurredAt: { gte: from, lt: to } },
    select: { id: true, leadId: true, occurredAt: true, createdAt: true, createdBy: { select: { userId: true } } },
  });
  const missing = activities.filter(activity => !factActivityIds.has(activity.id));
  if (!missing.length) return [];
  const [history, members] = await Promise.all([
    database.stageHistory.findMany({
      where: { workspaceId, leadId: { in: [...new Set(missing.map(activity => activity.leadId))] }, opportunityId: null, pipeline: { entityType: "LEAD" }, enteredAt: { lt: to }, OR: [{ exitedAt: null }, { exitedAt: { gt: from } }] },
      select: { leadId: true, pipelineId: true, enteredAt: true, exitedAt: true },
    }),
    database.workspaceMember.findMany({ where: { workspaceId, userId: { in: [...new Set(missing.flatMap(activity => activity.createdBy.userId ? [activity.createdBy.userId] : []))] } }, select: { id: true, userId: true } }),
  ]);
  const memberIds = new Map(members.map(member => [member.userId, member.id]));
  return missing.flatMap(activity => {
    const fronts = new Set(history.filter(row => row.leadId === activity.leadId && row.enteredAt <= activity.occurredAt && (!row.exitedAt || row.exitedAt > activity.occurredAt)).map(row => row.pipelineId));
    const pipelineId = fronts.size === 1 ? [...fronts][0]! : null;
    if (!pipelineId || !pipelineIds.has(pipelineId)) return [];
    const memberId = activity.createdBy.userId ? memberIds.get(activity.createdBy.userId) ?? null : null;
    return [{
      id: activity.id, eventType: "WHATSAPP_MESSAGE_SENT" as const, sourceEntityType: "AdvertisingMessageActivity", activityId: activity.id,
      pipelineId, safeMetadata: null, correctionSource: null, occurredAt: activity.occurredAt, recordedAt: activity.createdAt,
      leadId: activity.leadId, creditedMemberId: memberId, performedByMemberId: memberId, bookedByMemberId: null, meetingId: null, meetingOwnerMemberIdAtEvent: null,
      taskKind: null, result: "SENT", cadenceStepKey: null, quantity: 1, valueCents: null,
    }];
  });
}
