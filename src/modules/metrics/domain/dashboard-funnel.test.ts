import { describe, expect, it } from "vitest";

import { applyLedgerMilestoneBalance, chronologicalLeadStages, effectiveLeadMilestones } from "@/modules/metrics/domain/dashboard-funnel";

describe("funil sequencial da coorte", () => {
  it("não atribui conversão a quem pulou uma etapa ou a completou fora de ordem", () => {
    const stages = chronologicalLeadStages(new Map([["a", "2052-04-20T09:00:00Z"], ["b", "2052-04-20T09:00:00Z"], ["c", "2052-04-20T09:00:00Z"]]), [
      new Map([["a", ["2052-04-20T10:00:00Z"]], ["b", ["2052-04-20T10:00:00Z"]]]),
      new Map([["b", ["2052-04-20T11:00:00Z"]], ["c", ["2052-04-20T11:00:00Z"]]]),
      new Map([["b", ["2052-04-20T10:30:00Z"]]]),
      new Map([["b", ["2052-04-20T12:00:00Z"]]]),
    ]);
    expect(stages.map((stage) => [...stage.keys()])).toEqual([["a", "b"], ["b"], [], []]);
  });

  it("usa o horário vigente do log após estorno e mantém apenas reuniões da agenda", () => {
    const allowed = new Set(["lead-1"]);
    const facts = [
      { leadId: "lead-1", eventType: "CALL_CONNECTED", sourceEntityType: "Activity", occurredAt: "2052-04-20T10:00:00Z", quantity: 1 },
      { leadId: "lead-1", eventType: "CALL_CONNECTED", sourceEntityType: "Activity", occurredAt: "2052-04-20T10:00:00Z", quantity: -1 },
      { leadId: "lead-1", eventType: "INBOUND_MESSAGE_RECEIVED", sourceEntityType: "Message", occurredAt: "2052-04-20T11:00:00Z", quantity: 1 },
      { leadId: "lead-1", eventType: "MEETING_SCHEDULED", sourceEntityType: "StageHistory", occurredAt: "2052-04-20T12:00:00Z", quantity: 1 },
    ];
    expect(effectiveLeadMilestones([], facts, ["CALL_CONNECTED", "INBOUND_MESSAGE_RECEIVED"], allowed).get("lead-1")).toEqual(["2052-04-20T11:00:00Z"]);
    expect(effectiveLeadMilestones([], facts, ["MEETING_SCHEDULED"], allowed, "MeetingHistory").has("lead-1")).toBe(false);
  });

  it("aproveita uma tentativa posterior quando a primeira ocorreu antes da entrada no funil", () => {
    const stages = chronologicalLeadStages(new Map([["lead-1", "2052-04-20T09:00:00Z"]]), [
      new Map([["lead-1", ["2052-04-20T08:00:00Z", "2052-04-20T10:00:00Z"]]]),
      new Map([["lead-1", ["2052-04-20T09:30:00Z", "2052-04-20T11:00:00Z"]]]),
    ]);
    expect(stages[0].get("lead-1")).toBe("2052-04-20T10:00:00Z");
    expect(stages[1].get("lead-1")).toBe("2052-04-20T11:00:00Z");
  });

  it("retira do marco uma conexão estornada e mantém um lead com resposta humana", () => {
    const connected = applyLedgerMilestoneBalance(new Set(["lead-1", "lead-2", "lead-3"]), new Map([
      ["CALL_CONNECTED:lead-1", 0],
      ["CALL_CONNECTED:lead-2", 0],
      ["INBOUND_MESSAGE_RECEIVED:lead-2", 1],
    ]), ["CALL_CONNECTED:", "INBOUND_MESSAGE_RECEIVED:"]);
    expect([...connected]).toEqual(["lead-2", "lead-3"]);
  });
});
