import { beforeEach, describe, expect, it, vi } from "vitest";

import { prospectingTaskMetricEvents } from "@/modules/prospecting/domain/prospecting-task-metric-events";
import { recordTaskCompletionMetricFactsInTransaction, taskCompletionMetricEventTypes } from "./task-completion-metric-facts";

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("./commercial-metric-fact-writer", () => ({ recordCommercialMetricFactInTransaction: record }));
const input = { workspaceId: "workspace", taskId: "task", leadId: "lead", opportunityId: null, activityId: "first", assigneeMemberId: "owner", performedByMemberId: "seller", leadOwnerMemberId: "owner", kind: "CALL", result: "CONNECTED", dueAt: new Date("2026-10-22T15:00:00Z"), completedAt: new Date("2026-10-22T14:00:00Z"), executionMode: "MANUAL" as const };

describe("identidade dos fatos de conclusão de tarefas", () => {
  beforeEach(() => record.mockReset());

  it("preserva chaves legadas na primeira conclusão e no replay da mesma atividade", async () => {
    for (const existing of [null, { id: "original", activityId: "first" }]) {
      record.mockClear();
      const transaction = { commercialMetricFact: { findUnique: vi.fn().mockResolvedValue(existing) } };
      await recordTaskCompletionMetricFactsInTransaction(transaction as never, input);
      expect(record.mock.calls.map(call => call[1].eventKey)).toEqual(["task:task:completed:v1", "task:task:call-attempted:v1", "task:task:call-connected:v1"]);
    }
  });

  it("isola correção e reconclusão por atividade, mantendo atribuição ao executor", async () => {
    const transaction = { commercialMetricFact: { findUnique: vi.fn().mockResolvedValue({ id: "original", activityId: "first" }) } };
    await recordTaskCompletionMetricFactsInTransaction(transaction as never, { ...input, activityId: "correction", result: "NO_ANSWER" });
    expect(record.mock.calls.map(call => call[1].eventKey)).toEqual(["task:task:completed:activity:correction:v1", "task:task:call-attempted:activity:correction:v1", "task:task:call-unanswered:activity:correction:v1"]);
    expect(record.mock.calls.every(call => call[1].creditedMemberId === "seller" && call[1].workspaceId === "workspace")).toBe(true);
  });

  it("inclui no contrato de compensação todos os eventos dos canais de conclusão", () => {
    for (const kind of ["CALL", "WHATSAPP", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"]) {
      for (const result of [null, "CONNECTED", "CALLBACK_REQUESTED", "WHATSAPP_SHARED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "CHANNEL_UNAVAILABLE", "SENT", "NO_WHATSAPP", "OTHER", "COMPLETED"]) {
        for (const event of prospectingTaskMetricEvents(kind, result)) expect(taskCompletionMetricEventTypes).toContain(event.eventType);
      }
    }
  });
});
