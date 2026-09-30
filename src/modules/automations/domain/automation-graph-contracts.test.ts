import { describe, expect, it } from "vitest";

import { acceptanceGraph } from "@/modules/automations/application/automation-builder-service";
import { evaluateGraphCondition, validateAutomationGraph } from "@/modules/automations/domain/automation-graph-contracts";

describe("automation visual graph", () => {
  it("aceita o fluxo lead → triagem → tarefa → espera → condição → handoff", () => {
    const result = validateAutomationGraph(acceptanceGraph);
    expect(result.valid).toBe(true);
    expect(result.topologicalOrder).toEqual(["lead", "triage", "task", "wait", "condition", "handoff", "end"]);
  });

  it("rejeita ciclos, saída ambígua e webhook arbitrário", () => {
    const graph = structuredClone(acceptanceGraph);
    graph.nodes[1]!.config = { webhook: "https://example.com/escape" };
    graph.edges.push({ id: "cycle", source: "end", target: "lead", branch: "ALWAYS" });
    const result = validateAutomationGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/Webhook arbitrário/);
    expect(result.issues.join(" ")).toMatch(/ciclo/);
    expect(result.issues.join(" ")).toMatch(/não pode ter saída/);
  });

  it("avalia condições E e OU somente sobre dados do payload", () => {
    const rules = [
      { path: "lead.score", operator: "EQUALS", value: 80 },
      { path: "lead.qualified", operator: "EQUALS", value: true },
    ];
    const payload = { lead: { score: 80, qualified: false } };
    expect(evaluateGraphCondition({ mode: "ALL", rules }, payload)).toBe(false);
    expect(evaluateGraphCondition({ mode: "ANY", rules }, payload)).toBe(true);
  });
});
