export const SDR_QUEUE_TASK_COMPLETED_EVENT =
  "politizai:sdr-queue-task-completed";

export type SdrQueueTaskCompletedDetail = Readonly<{
  leadId: string;
  taskId: string;
}>;

export function notifySdrQueueTaskCompleted(
  detail: SdrQueueTaskCompletedDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<SdrQueueTaskCompletedDetail>(
      SDR_QUEUE_TASK_COMPLETED_EVENT,
      { detail },
    ),
  );
}
