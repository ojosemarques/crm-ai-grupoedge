import { describe, expect, it } from "vitest";
import { localCopilotAnswer } from "./copilot-local-answer";

describe("consulta local sem OpenAI", () => {
  it("responde valores financeiros verificados sem chamar modelo e declara o recorte", () => {
    const result = localCopilotAnswer("Como está meu financeiro?", {
      sources: [{ key: "financeiro", label: "Financeiro", href: "/financeiro", data: { summary: { receivedCents: "2500000", expenseCents: "300000", cashBalanceCents: "2200000", mrrCents: "300000", netRevenueCents: "2500000", netIncomeCents: "2200000" } } }], unavailable: [],
      period: { preset: "CUSTOM", fromDate: "2025-01-01", toDate: "2025-12-31", from: "2025-01-01T03:00:00Z", to: "2026-01-01T03:00:00Z", timeZone: "America/Sao_Paulo", assumed: false },
    });
    expect(result.answer).toContain("25.000,00");
    expect(result.answer).toContain("MRR atual");
    expect(result.answer).toContain("2025-01-01 a 2025-12-31");
    expect(result.proposal).toBeNull();
  });
  it("respeita centavos, basis points e métrica ausente em mídia", () => {
    const result = localCopilotAnswer("Qual o CPL dos anúncios?", { sources: [{ key: "anuncios", label: "Anúncios", href: "/aquisicao/midia", data: { metrics: [{ label: "CPL", value: 1234, unit: "BRL_CENTS" }, { label: "CTR", value: 215, unit: "BPS" }, { label: "Hook rate", value: null, unit: "BPS" }] } }], unavailable: [] });
    expect(result.answer).toContain("12,34");
    expect(result.answer).toContain("2.15%");
    expect(result.answer).toContain("Hook rate: sem base");
  });
  it("não responde com fontes sem permissão", () => {
    const result = localCopilotAnswer("Como está o caixa?", { sources: [], unavailable: ["financeiro"] });
    expect(result.answer).toContain("não tem acesso");
    expect(result.sources).toEqual([]);
  });
});

it("consulta cadastro e vínculos do cliente sem depender de OpenAI", () => {
  const result = localCopilotAnswer("Detalhes do cliente Acme", { sources: [{ key: "clientes", label: "Clientes", href: "/contas", data: { total: 1, sampleLimit: 50, clients: [{ name: "Acme", status: "ACTIVE", peopleCount: 2, openOpportunities: 1 }], detail: { name: "Acme", legalName: "Acme Ltda", domain: "acme.example", leads: [{}], onboarding: [{}], requests: [] } } }], unavailable: [] });
  expect(result.answer).toContain("Acme Ltda");
  expect(result.answer).toContain("1 onboardings");
  expect(result.answer).toContain("Abra Ações");
  expect(result.links).toEqual([{ label: "Clientes", href: "/contas", entityType: "MODULE" }]);
});

it("mostra tarefas e atrasos com limite explícito da amostra", () => {
  const result = localCopilotAnswer("Quais tarefas estão atrasadas?", { sources: [{ key: "tarefas", label: "Tarefas", href: "/leads", data: { coverage: "Amostra dos primeiros 5 leads autorizados.", leads: [{ leadName: "Maria", tasks: [{ title: "Ligar", dueAt: "2026-09-29T12:00:00Z", overdue: true }] }] } }], unavailable: [] });
  expect(result.answer).toContain("Amostra dos primeiros 5");
  expect(result.answer).toContain("Maria: Ligar");
  expect(result.answer).toContain("(atrasada)");
});

it("resume o dia e recomenda a próxima ação usando a fila operacional", () => {
  const result = localCopilotAnswer("Faça meu resumo do dia e indique a próxima ação", { sources: [{ key: "operacao_diaria", label: "Meu dia", href: "/meu-dia", data: { dailyProduction: { callsPending: 4, messagesPending: 6, overdueFollowUps: 2, meetingsScheduled: 1, staleLeads: 3, dailyGoal: { completed: 5, target: 10, progressPercent: 50 } }, priorities: [{ title: "Atrasados", total: 2, items: [{ leadName: "Ana", recommendation: { label: "Ligar agora", reason: "retorno vencido" } }] }] } }], unavailable: [] });
  expect(result.answer).toContain("4 ligações pendentes");
  expect(result.answer).toContain("Meta: 5/10 (50%)");
  expect(result.answer).toContain("Ana: Ligar agora");
  expect(result.proposal).toBeNull();
});

it("mantém previsão ausente e comparação como correlação, sem inventar resultado", () => {
  const result = localCopilotAnswer("Explique a queda nas vendas e a previsão de fechamento", { sources: [
    { key: "indicadores_vendas", label: "Indicadores", href: "/dashboard", data: { comparisons: [{ label: "Vendas", current: { value: 3 }, previous: { value: 6 }, direction: "DOWN", interpretationLabel: "Piorou" }] } },
    { key: "forecast", label: "Forecast", href: "/forecast", data: { current: null } },
  ], unavailable: [] });
  expect(result.answer).toContain("atual 3, anterior 6");
  expect(result.answer).toContain("não comprovam a causa");
  expect(result.answer).toContain("nenhum snapshot autorizado");
});
