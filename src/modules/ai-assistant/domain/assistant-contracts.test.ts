import { describe, expect, it } from "vitest";

import { assistantCommandSchema, inferManagerQuestion, inferProposalType } from "./assistant-contracts";

describe("assistant contracts", () => {
  it("interpreta intenção gerencial em linguagem natural", () => {
    expect(inferManagerQuestion("Onde o funil mais perde conversão neste mês?")).toBe("BIGGEST_FUNNEL_LOSS");
    expect(inferManagerQuestion("Quais oportunidades estão paradas?")).toBe("STALLED_OPPORTUNITIES");
  });

  it("recusa intenção gerencial ampla ou ambígua", () => {
    expect(inferManagerQuestion("Qual foi a perda financeira do mês?")).toBeNull();
    expect(inferManagerQuestion("Compare SDRs abaixo da média com a perda do funil")).toBeNull();
  });

  it("classifica configuração e mantém a proposta como comando explícito", () => {
    expect(inferProposalType("Crie uma automação para novos contatos")).toBe("AUTOMATION");
    expect(inferProposalType("Faça uma coisa nova")).toBeNull();
    expect(assistantCommandSchema.parse({ action: "PROPOSE", payload: { request: "Crie um agente de triagem comercial" } }).action).toBe("PROPOSE");
  });

  it("não inventa uma métrica para texto desconhecido", () => {
    expect(inferManagerQuestion("Conte algo interessante")).toBeNull();
    expect(inferManagerQuestion("Quais SDRs estão abaixo da média e onde o funil perde conversão?")).toBeNull();
  });

  it("exige intervalo completo no período personalizado", () => {
    expect(assistantCommandSchema.safeParse({ action: "QUERY", payload: { question: "Quais leads precisam de ação?", preset: "CUSTOM", fromDate: "2026-09-01" } }).success).toBe(false);
  });
});
