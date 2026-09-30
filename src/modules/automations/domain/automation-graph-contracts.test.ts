import { describe, expect, it } from "vitest";

import { acceptanceGraph } from "@/modules/automations/application/automation-builder-service";
import { evaluateGraphCondition, nextNodeId, validateAutomationGraph } from "@/modules/automations/domain/automation-graph-contracts";

const agentId = "00000000-0000-4000-8000-000000000012";

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

  it("valida blocos governados de agente e os ramos de intenção/sem resposta", () => {
    const graph = structuredClone(acceptanceGraph);
    graph.nodes = [
      graph.nodes[0]!,
      { id: "start-agent", type: "AGENT_START_CONVERSATION", label: "Iniciar agente", config: { agentId, conversationIdPath: "conversationId", messagePath: "message" }, estimatedCostCents: 0 },
      { id: "collect", type: "AGENT_COLLECT_FIELDS", label: "Coletar proposta", config: { agentId, fields: ["email", "proposta", "etapa"] }, estimatedCostCents: 0 },
      { id: "route", type: "AGENT_ROUTE", label: "Resposta recebida?", config: { agentId, intentPath: "agentTurn.intent", noResponsePath: "agentTurn.noResponse" }, estimatedCostCents: 0 },
      { id: "handoff", type: "HUMAN_HANDOFF", label: "Handoff", config: { reason: "Sem resposta" }, estimatedCostCents: 0 },
      graph.nodes.at(-1)!,
    ];
    graph.edges = [
      { id: "a1", source: "lead", target: "start-agent", branch: "ALWAYS" },
      { id: "a2", source: "start-agent", target: "collect", branch: "ALWAYS" },
      { id: "a3", source: "collect", target: "route", branch: "ALWAYS" },
      { id: "a4", source: "route", target: "end", branch: "INTENT" },
      { id: "a5", source: "route", target: "handoff", branch: "NO_RESPONSE" },
      { id: "a6", source: "handoff", target: "end", branch: "ALWAYS" },
    ];

    const result = validateAutomationGraph(graph);
    expect(result.valid).toBe(true);
    expect(nextNodeId(graph, "route", "INTENT")).toBe("end");
    expect(nextNodeId(graph, "route", "NO_RESPONSE")).toBe("handoff");
  });

  it("rejeita agente inválido, campos duplicados e roteamento incompleto", () => {
    const graph = structuredClone(acceptanceGraph);
    graph.nodes.splice(1, 0, { id: "agent", type: "AGENT_COLLECT_FIELDS", label: "Agente inválido", config: { agentId: "client-controlled", fields: ["proposta", "proposta", "cidadao.cpf"] }, estimatedCostCents: 0 });
    graph.edges[0] = { id: "to-agent", source: "lead", target: "agent", branch: "ALWAYS" };
    graph.edges.push({ id: "from-agent", source: "agent", target: "triage", branch: "ALWAYS" });

    const result = validateAutomationGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/Agente inválido/);
    expect(result.issues.join(" ")).toMatch(/duplicados/);
    expect(result.issues.join(" ")).toMatch(/Dados cidadãos do OS são proibidos/);
  });
});
