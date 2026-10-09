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

  await recordCommercialMetricFactInTransaction(transaction, {
    ...common,
    eventKey: `task:${input.taskId}:completed:v1`,
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
      eventKey: `task:${input.taskId}:${event.eventKeySuffix}:v1`,
      eventType: event.eventType,
      channel: event.channel,
      direction: "OUTBOUND" as const,
    });
  }
}
