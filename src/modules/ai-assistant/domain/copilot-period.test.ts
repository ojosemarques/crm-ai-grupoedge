import { describe, expect, it } from "vitest";
import { resolveCopilotPeriod } from "./copilot-period";

describe("período do Copilot", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const tz = "America/Sao_Paulo";
  it("resolve mês passado e última semana no timezone do workspace", () => {
    expect(resolveCopilotPeriod("DRE do mês passado", now, tz)).toMatchObject({ from: "2026-08-01T03:00:00.000Z", to: "2026-09-01T03:00:00.000Z", assumed: false });
    expect(resolveCopilotPeriod("anúncios da última semana", now, tz)).toMatchObject({ fromDate: "2026-09-21", toDate: "2026-09-27" });
  });
  it("resolve ano, mês nomeado e datas brasileiras explícitas", () => {
    expect(resolveCopilotPeriod("Vendas de 2025", now, tz)).toMatchObject({ fromDate: "2025-01-01", toDate: "2025-12-31" });
    expect(resolveCopilotPeriod("Receita de fevereiro 2024", now, tz)).toMatchObject({ fromDate: "2024-02-01", toDate: "2024-02-29" });
    expect(resolveCopilotPeriod("Caixa de 01/03/2026 a 15/03/2026", now, tz)).toMatchObject({ fromDate: "2026-03-01", toDate: "2026-03-15" });
  });
  it("não supõe mês atual quando período é ambíguo", () => {
    expect(() => resolveCopilotPeriod("DRE do último trimestre", now, tz)).toThrow("duas datas");
    expect(() => resolveCopilotPeriod("Receita da semana retrasada", now, tz)).toThrow("duas datas");
    expect(() => resolveCopilotPeriod("Agosto versus setembro", now, tz)).toThrow("intervalo");
    expect(resolveCopilotPeriod("Como está o caixa?", now, tz)).toMatchObject({ assumed: true, fromDate: "2026-09-01", toDate: "2026-09-30" });
  });
  it("não interpreta prazo da venda como período financeiro", () => {
    expect(resolveCopilotPeriod("Feche a venda 25 mil, 3 mil por 6 meses", now, tz)).toMatchObject({ preset: "MONTH", assumed: true });
  });
  it.each([
    "Crie uma tarefa para amanhã às 10h",
    "Atualize o cliente e marque o retorno para semana que vem",
    "Prepare a criação de uma tarefa para 01/10/2026",
    "Baixe o recebimento de ontem",
  ])("preserva datas operacionais sem bloquear a ação: %s", (message) => {
    expect(resolveCopilotPeriod(message, now, tz)).toMatchObject({ preset: "MONTH", assumed: true });
  });
  it("respeita virada do mês em UTC e ano anterior", () => {
    expect(resolveCopilotPeriod("mês passado", new Date("2026-01-01T01:00:00Z"), tz)).toMatchObject({ fromDate: "2025-11-01", toDate: "2025-11-30" });
  });
  it.each(["amanhã às10", "amanhã às 10h", "para amanhã às 10:30", "hoje às 10", "semana que vem"])("reconhece prazo como continuação de pedido operacional: %s", (message) => {
    const retrievalQuery = `${message}\nCrie uma tarefa de retorno para Zeta Distante`;
    expect(resolveCopilotPeriod(message, now, tz, retrievalQuery)).toMatchObject({ preset: "MONTH", assumed: true });
  });
  it("mantém períodos de novas consultas mesmo após um pedido operacional", () => {
    const previous = "Crie uma tarefa para Zeta Distante";
    expect(resolveCopilotPeriod("DRE do mês passado", now, tz, `DRE do mês passado\n${previous}`)).toMatchObject({ fromDate: "2026-08-01", toDate: "2026-08-31", assumed: false });
    expect(resolveCopilotPeriod("hoje", now, tz, `hoje\n${previous}`)).toMatchObject({ preset: "TODAY", assumed: false });
    expect(() => resolveCopilotPeriod("amanhã às 10", now, tz)).toThrow("duas datas");
    expect(() => resolveCopilotPeriod("amanhã às 10", now, tz, `amanhã às 10\n${previous}\nQual o saldo?`)).toThrow("duas datas");
  });
});
