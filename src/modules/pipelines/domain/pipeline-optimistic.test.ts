import { describe, expect, it } from "vitest";
import { movePipelineCard } from "@/modules/pipelines/domain/pipeline-optimistic";
import type { LeadPipelineCard, LeadPipelineStageColumn } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

const lead: LeadPipelineCard = { id: "lead-1", fullName: "Lead", jobTitle: null, priorityCode: "P2", score: 50, responsibleName: "Ana", currentStageName: "Novo", nextActionAt: null, nextActionDescription: null, pactoReady: false };
const health = { stalled: 0, averageHoursInStage: 0, conversionToNextPercent: null, withoutTask: 0, withoutRecentContact: 0, aboveExpectedLimit: 0, actionDueToday: 0, expectedLimitHours: 24, conversionPeriodDays: 90 };
const stage = (id: string, name: string, leads: readonly LeadPipelineCard[]): LeadPipelineStageColumn => ({ id, code: id === "new" ? "NEW" : "CONNECTED", name, position: 0, count: leads.length, displayedCount: leads.length, health, leads });

describe("movePipelineCard", () => {
  it("move o card e atualiza os contadores imediatamente", () => {
    const result = movePipelineCard([stage("new", "Novo", [lead]), stage("connected", "Conectado", [])], lead, "new", "connected", "Conectado");
    expect(result[0]).toMatchObject({ count: 0, displayedCount: 0, leads: [] });
    expect(result[1]).toMatchObject({ count: 1, displayedCount: 1 });
    expect(result[1]?.leads[0]?.currentStageName).toBe("Conectado");
  });

  it("preserva o quadro se a origem ou destino não existir", () => {
    const stages = [stage("new", "Novo", [lead])];
    expect(movePipelineCard(stages, lead, "new", "missing", "Inexistente")).toBe(stages);
  });
});
