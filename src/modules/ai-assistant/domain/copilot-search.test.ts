import { describe, expect, it, vi } from "vitest";
import { compactCopilotData, copilotSearchTerms, searchCopilotPages } from "./copilot-search";

describe("recuperação limitada por nomes do Copilot", () => {
  it("extrai nomes preservando acentos e prioriza nomes explícitos entre aspas", () => {
    expect(copilotSearchTerms("Crie uma tarefa para João Silva amanhã")).toEqual(["João Silva", "João", "Silva"]);
    expect(copilotSearchTerms('Mostre detalhes do cliente "João da Silva"')).toEqual(["João da Silva"]);
    expect(copilotSearchTerms("Qual o saldo financeiro deste mês?")).not.toContain("financeiro");
    expect(copilotSearchTerms("Crie uma tarefa para Alfa Beta Gama Delta Epsilon Zeta")).toHaveLength(4);
  });
  it("consulta antes de paginar, deduplica resultados e não inventa total para buscas sobrepostas", async () => {
    const search = vi.fn(async (term: string) => ({ items: [{ id: "antigo", name: term }], total: 150 }));
    const result = await searchCopilotPages(["Cliente distante", "distante"], search, 20);
    expect(search.mock.calls).toEqual([["Cliente distante"], ["distante"]]);
    expect(result).toMatchObject({ items: [{ id: "antigo" }], total: null, matchedCount: 1, truncated: true });
  });
  it("consulta uma página padrão sem texto e preserva seu total autorizado", async () => {
    expect(await searchCopilotPages([], async () => ({ items: [{ id: "1" }, { id: "2" }], total: 10 }), 1)).toMatchObject({ items: [{ id: "1" }], total: 10, truncated: true });
  });
  it("compacta amostras extensas sem recalcular métricas ou ocultar a cobertura", () => {
    const data = compactCopilotData({ totalCents: 1234567890123456789n, generatedAt: new Date("2026-09-30T00:00:00Z"), rows: Array.from({ length: 1000 }, (_, id) => ({ id, name: "Texto longo ".repeat(1000) })) });
    expect(data).toMatchObject({ totalCents: "1234567890123456789", generatedAt: "2026-09-30T00:00:00.000Z", contextLimits: { truncated: true } });
    expect(JSON.stringify(data).length).toBeLessThan(17_000);
  });
});
