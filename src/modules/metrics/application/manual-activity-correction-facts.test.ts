import type { CommercialMetricFact } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { manualActivityCorrectionFacts } from "./manual-activity-correction-facts";

describe("fatos corretivos de atividades", () => {
  it("mantém a atribuição original e registra estorno mais substituição na data da ligação", () => {
    const occurredAt = new Date("2032-07-18T15:00:00.000Z");
    const correctedAt = new Date("2032-07-19T15:00:00.000Z");
    const originalFacts = [{
      id: "fact-1", eventKey: "activity:original:call-attempted:v1", leadId: "lead-1",
      creditedMemberId: "seller-1", performedByMemberId: "seller-1", teamId: "team-1",
      sourceId: "source-1", pipelineId: "pipeline-1", stageId: "stage-1",
      direction: "OUTBOUND", activityType: "CALL", executionMode: "MANUAL",
    }] as CommercialMetricFact[];
    const facts = manualActivityCorrectionFacts({
      workspaceId: "workspace-1", originalId: "original", correctionId: "correction",
      originalOccurredAt: occurredAt, correctionOccurredAt: correctedAt,
      reason: "Desfecho incorreto", type: "CALL", direction: "OUTBOUND",
      previousResult: "NOT_CONNECTED", correctedResult: "CONNECTED", originalFacts,
    });
    expect(facts.map((fact) => [fact.eventType, fact.quantity, fact.result])).toEqual([
      ["CALL_ATTEMPTED", -1, "NOT_CONNECTED"], ["CALL_UNANSWERED", -1, "NOT_CONNECTED"],
      ["CALL_ATTEMPTED", 1, "CONNECTED"], ["CALL_CONNECTED", 1, "CONNECTED"],
    ]);
    expect(facts.every((fact) => fact.occurredAt === occurredAt && fact.creditedMemberId === "seller-1" && fact.teamId === "team-1")).toBe(true);
    expect(facts[0]).toMatchObject({ sourceEntityId: "correction", correctionOfFactId: "fact-1", reversedAt: correctedAt, reversalReason: "Desfecho incorreto" });
    expect(facts[1]?.correctionOfFactId).toBeUndefined();
  });
});
