import { describe, expect, it } from "vitest";
import { agentDefinitionSchema, internalSubagents } from "@/modules/ai-agents/domain/governed-agent-contracts";

describe("governed agent contracts", () => {
  it("mantém os dez subagentes internos em rascunho", () => {
    expect(internalSubagents).toHaveLength(10);
    expect(internalSubagents.every((agent) => agent.status === "DRAFT")).toBe(true);
  });
  it("restringe modelo, ferramentas e dados do agente", () => {
    const result = agentDefinitionSchema.safeParse({ instructions: "Responda apenas com fatos da base aprovada e entregue fontes.", tone: "CONSULTATIVE", audience: "Equipe comercial", offerScope: "Catálogo ativo", model: "modelo-externo", budgetCents: 0, maxInputTokens: 1000, maxOutputTokens: 500, allowedDataFields: ["citizen.cpf"], allowedTools: ["ARBITRARY_WEBHOOK"], knowledge: { title: "Base", content: "Conteúdo aprovado e suficientemente extenso para grounding.", sourceReference: "kb://base/v1" } });
    expect(result.success).toBe(false);
  });
});
