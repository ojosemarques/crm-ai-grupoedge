import { describe, expect, it } from "vitest";
import { createStrategyFunnelSchema, strategyFunnelDefinitionSchema } from "./strategy-funnel-contracts";

const pageId = "10000000-0000-4000-8000-000000000001";
const firstNodeId = "20000000-0000-4000-8000-000000000001";
const secondNodeId = "20000000-0000-4000-8000-000000000002";

describe("contrato do editor de estratégias", () => {
  it("aceita uma jornada ordenada entre página e WhatsApp", () => {
    const result = createStrategyFunnelSchema.parse({
      name: "Aquisição eleitoral",
      description: "Jornada principal",
      idempotencyKey: "strategy:test:001",
      definition: { schema: "strategy.funnel/v1", nodes: [
        { id: firstNodeId, type: "LANDING_PAGE", label: "Página", referenceId: pageId },
        { id: secondNodeId, type: "WHATSAPP", label: "Atendimento", referenceId: null },
      ] },
    });
    expect(result.definition.nodes.map((node) => node.type)).toEqual(["LANDING_PAGE", "WHATSAPP"]);
  });

  it("exige referência nas etapas persistidas e proíbe referência artificial no WhatsApp", () => {
    expect(strategyFunnelDefinitionSchema.safeParse({ schema: "strategy.funnel/v1", nodes: [
      { id: firstNodeId, type: "FORM", label: "Formulário", referenceId: null },
      { id: secondNodeId, type: "WHATSAPP", label: "WhatsApp", referenceId: pageId },
    ] }).success).toBe(false);
  });

  it("rejeita etapas duplicadas e jornadas com menos de duas etapas", () => {
    expect(strategyFunnelDefinitionSchema.safeParse({ schema: "strategy.funnel/v1", nodes: [
      { id: firstNodeId, type: "WHATSAPP", label: "Contato", referenceId: null },
      { id: firstNodeId, type: "WHATSAPP", label: "Qualificação", referenceId: null },
    ] }).success).toBe(false);
    expect(strategyFunnelDefinitionSchema.safeParse({ schema: "strategy.funnel/v1", nodes: [
      { id: firstNodeId, type: "WHATSAPP", label: "Contato", referenceId: null },
    ] }).success).toBe(false);
  });
});
