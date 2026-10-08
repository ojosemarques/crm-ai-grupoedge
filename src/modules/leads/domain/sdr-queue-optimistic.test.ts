import { describe, expect, it } from "vitest";

import { hideCompletedTaskFromSections } from "@/modules/leads/domain/sdr-queue-optimistic";
import type {
  SdrQueueItem,
  SdrQueueSection,
} from "@/modules/leads/domain/sdr-queue-contracts";

function queueItem(
  leadId: string,
  taskId: string,
): SdrQueueItem {
  return {
    id: leadId,
    fullName: `Lead ${leadId}`,
    jobTitle: null,
    pain: null,
    priorityCode: null,
    score: null,
    priorityReason: null,
    responsibleName: "Vendedor",
    responsibleType: "MEMBER",
    pipelineName: "Prospecção ativa",
    stageName: "Abordagem inicial",
    stagePosition: 1,
    receivedAt: "2030-01-01T12:00:00.000Z",
    firstHumanAttemptAt: null,
    slaSeconds: null,
    healthyMaxSeconds: null,
    attentionMaxSeconds: null,
    lastActivityAt: "2030-01-01T12:00:00.000Z",
    lastActivitySubject: null,
    nextActionTaskId: taskId,
    nextActionAt: "2030-01-01T12:00:00.000Z",
    nextActionDescription: "Ligar",
    nextActionKind: "CALL",
    nextActionSourceKey: `active-prospecting:cadence:${taskId}`,
    awaitingHumanResponse: false,
    lastInboundResponseAt: null,
    meetingTodayId: null,
    meetingTodayStartsAt: null,
    recommendation: {
      code: "CALL_NOW",
      label: "Ligar agora",
      reason: "Tarefa vencida",
      href: `/leads/${leadId}/historico`,
    },
  };
}

function section(
  key: SdrQueueSection["key"],
  items: readonly SdrQueueItem[],
  total = items.length,
): SdrQueueSection {
  return {
    key,
    title: key,
    description: key,
    total,
    drilldownHref: "/leads",
    items,
  };
}

describe("hideCompletedTaskFromSections", () => {
  it("remove a tarefa concluída de todas as filas e preserva outra tarefa do mesmo lead", () => {
    const completed = queueItem("lead-1", "task-completed");
    const nextTask = queueItem("lead-1", "task-next");
    const otherLead = queueItem("lead-2", "task-other");

    const result = hideCompletedTaskFromSections(
      [
        section("NOW", [completed, otherLead], 5),
        section("OVERDUE", [completed], 1),
        section("RETURN_TODAY", [nextTask], 1),
      ],
      new Set(["task-completed"]),
    );

    expect(result[0]).toMatchObject({ total: 4, items: [otherLead] });
    expect(result[1]).toMatchObject({ total: 0, items: [] });
    expect(result[2]).toMatchObject({ total: 1, items: [nextTask] });
  });
});
