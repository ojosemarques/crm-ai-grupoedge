import { describe, expect, it } from "vitest";

import {
  buildGovernedAgentNodeSnapshot,
  selectAutomationNodeBranch,
} from "@/modules/automations/application/automation-builder-service";
import type { AutomationGraphNode } from "@/modules/automations/domain/automation-graph-contracts";

const agentId = "00000000-0000-4000-8000-000000000012";

describe("automation builder governed agent nodes", () => {
  it("registra preço, proposta e etapa somente como proposta pendente de aprovação", () => {
    const node: AutomationGraphNode = {
      id: "collect",
      type: "AGENT_COLLECT_FIELDS",
      label: "Coletar campos",
      config: { agentId, fields: ["contact.email", "opportunity.price", "opportunity.proposta", "opportunity.etapa"] },
      estimatedCostCents: 0,
    };

    const snapshot = buildGovernedAgentNodeSnapshot(node, {
      agentTurn: {
        proposedFields: {
          contact: { email: "lead@example.test" },
          opportunity: { price: 9_900, proposta: "Plano anual", etapa: "NEGOCIACAO" },
        },
      },
    }, "run:node:collect");

    expect(snapshot).toMatchObject({
      kind: "AGENT_FIELDS_PROPOSED",
      status: "PENDING_HUMAN_APPROVAL",
      authoritativeMutation: false,
      sensitiveFields: ["opportunity.price", "opportunity.proposta", "opportunity.etapa"],
      proposedFields: {
        "contact.email": "lead@example.test",
        "opportunity.price": 9_900,
        "opportunity.proposta": "Plano anual",
        "opportunity.etapa": "NEGOCIACAO",
      },
    });
  });

  it("ramifica sem resposta e prepara início sem copiar a mensagem para o snapshot", () => {
    const route: AutomationGraphNode = {
      id: "route",
      type: "AGENT_ROUTE",
      label: "Rotear",
      config: { agentId },
      estimatedCostCents: 0,
    };
    const start: AutomationGraphNode = {
      id: "start",
      type: "AGENT_START_CONVERSATION",
      label: "Iniciar",
      config: { agentId },
      estimatedCostCents: 0,
    };

    expect(selectAutomationNodeBranch(route, { agentTurn: { noResponse: true } })).toBe("NO_RESPONSE");
    expect(selectAutomationNodeBranch(route, { agentTurn: { noResponse: false, intent: "diagnostico" } })).toBe("INTENT");
    expect(buildGovernedAgentNodeSnapshot(start, { conversationId: "conversation-1", message: "conteúdo sensível" }, "effect-1")).toEqual({
      kind: "AGENT_CONVERSATION_START_PROPOSED",
      status: "PENDING_AGENT_RUNTIME",
      action: "START_CONVERSATION",
      agentId,
      conversationId: "conversation-1",
      idempotencyKey: "effect-1",
      messagePresent: true,
      externalEgress: false,
    });
  });
});
