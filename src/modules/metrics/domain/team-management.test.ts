import { describe, expect, it } from "vitest";
import { buildCoachingSuggestions, taskCompletionPercentage, workedQueueCorrectly } from "@/modules/metrics/domain/team-management";
import type { TeamManagementPerson } from "@/modules/metrics/domain/team-management-contracts";

const person = (overrides: Partial<TeamManagementPerson> = {}): TeamManagementPerson => ({
  id: "member-1", name: "Ana", roles: ["SDR"], contacts: 20, meetings: 3,
  averageFirstResponseSeconds: 90, sdrConversionPercentage: 30, sellerConversionPercentage: null,
  tasksTotal: 10, tasksCompleted: 9, taskCompletionPercentage: 90,
  leadsWithoutNextAction: 0, forgottenLeads: 0, workedQueueCorrectly: true, ...overrides,
});

describe("team management", () => {
  it("calcula a disciplina da fila com os critérios publicados", () => {
    expect(taskCompletionPercentage(8, 10)).toBe(80);
    expect(taskCompletionPercentage(0, 0)).toBeNull();
    expect(workedQueueCorrectly(person())).toBe(true);
    expect(workedQueueCorrectly(person({ leadsWithoutNextAction: 1 }))).toBe(false);
    expect(workedQueueCorrectly(person({ taskCompletionPercentage: 79.99 }))).toBe(false);
  });

  it("gera coaching acionável para desvios reais", () => {
    const suggestions = buildCoachingSuggestions([
      person({ leadsWithoutNextAction: 2, forgottenLeads: 1, averageFirstResponseSeconds: 240, taskCompletionPercentage: 60 }),
    ]);
    expect(suggestions.map((item) => item.title)).toEqual([
      "Planejar o próximo passo", "Recuperar leads esquecidos", "Reduzir o tempo de resposta", "Melhorar a execução da fila",
    ]);
  });
});
