import type { CommercialMetricExecutionMode, Prisma } from "@/generated/prisma/client";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { prospectingTaskMetricEvents } from "@/modules/prospecting/domain/prospecting-task-metric-events";

type TaskCompletionMetricInput = Readonly<{
  workspaceId: string;
  taskId: string;
  leadId: string;
  opportunityId: string | null;
  activityId: string;
  assigneeMemberId: string | null;
  performedByMemberId: string | null;
  leadOwnerMemberId: string | null;
  kind: string;
  result: string | null;
  dueAt: Date;
  completedAt: Date;
  executionMode: CommercialMetricExecutionMode;
}>;

export const taskCompletionMetricEventTypes = [
  "TASK_COMPLETED", "CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED",
  "WHATSAPP_MESSAGE_SENT", "WHATSAPP_UNAVAILABLE", "WHATSAPP_OTHER",
  "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED",
] as const;

export async function recordTaskCompletionMetricFactsInTransaction(
  transaction: Pick<Prisma.TransactionClient, "commercialMetricFact">,
  input: TaskCompletionMetricInput,
) {
  const common = {
    workspaceId: input.workspaceId,
    occurredAt: input.completedAt,
    sourceEntityType: "Task",
    sourceEntityId: input.taskId,
    leadId: input.leadId,
    opportunityId: input.opportunityId,
    taskId: input.taskId,
    activityId: input.activityId,
    creditedMemberId: input.performedByMemberId ?? input.assigneeMemberId,
    performedByMemberId: input.performedByMemberId,
    leadOwnerMemberIdAtEvent: input.leadOwnerMemberId,
    taskKind: input.kind,
    result: input.result,
    executionMode: input.executionMode,
  } as const;

  const completionBaseKey = `task:${input.taskId}:completed:v1`;
  const existingCompletion = await transaction.commercialMetricFact.findUnique({
    where: {
      workspaceId_eventKey: {
        workspaceId: input.workspaceId,
        eventKey: completionBaseKey,
      },
    },
    select: { id: true, activityId: true },
  });
  // Keep legacy keys for the first completion; later audited completions have their own identity.
  const activitySuffix = existingCompletion && existingCompletion.activityId !== input.activityId
    ? `:activity:${input.activityId}` : "";

  await recordCommercialMetricFactInTransaction(transaction, {
    ...common,
    eventKey: `task:${input.taskId}:completed${activitySuffix}:v1`,
    eventType: "TASK_COMPLETED",
    activityType: "TASK",
    safeMetadata: {
      dueAt: input.dueAt.toISOString(),
      completedOnTime: input.completedAt <= input.dueAt,
    },
  });

  for (const event of prospectingTaskMetricEvents(input.kind, input.result)) {
    await recordCommercialMetricFactInTransaction(transaction, {
      ...common,
      eventKey: `task:${input.taskId}:${event.eventKeySuffix}${activitySuffix}:v1`,
      eventType: event.eventType,
      channel: event.channel,
      direction: "OUTBOUND" as const,
    });
  }
}
