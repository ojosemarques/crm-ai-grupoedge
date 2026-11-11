import { describe, expect, it } from "vitest";
import { formBudgetObservation, marketingFormBudgetObservation } from "./form-budget-response";
import { createEmptyMarketingFormDefinition } from "./marketing-form-contracts";

const question = "Você estaria disposto a investir pelo menos R$ 1.000 por mês?";
const observedAt = new Date("2026-11-11T13:00:00Z");

describe("orçamento informado em formulários", () => {
  it.each([
    ["Não", "SEM BUDGET"],
    ["No momento, não", "SEM BUDGET"],
    ["Sim", "GREEN BUDGET"],
    ["Sim, estou disposto", "GREEN BUDGET"],
    ["Sim, se fizer sentido para o meu mandato", "YELLOW BUDGET"],
    ["Talvez", "YELLOW BUDGET"],
    ["Pode ser que sim", "YELLOW BUDGET"],
    ["Não sei", "YELLOW BUDGET"],
    ["de_r$_300_a_r$_500", "YELLOW BUDGET"],
  ])("classifica %s como %s", (displayValue, tag) => {
    expect(formBudgetObservation([{ questionKey: "meta", question, displayValue }], observedAt, true)?.tag).toBe(tag);
  });

  it("exige uma resposta à pergunta de investimento", () => {
    expect(formBudgetObservation([{ questionKey: "cargo", question: "Qual é seu cargo?", displayValue: "Sim" }], observedAt, true)).toBeNull();
    expect(formBudgetObservation([{ questionKey: "investimento_mensal", question, displayValue: " " }], observedAt, false)).toBeNull();
  });

  it("interpreta a chave da opção pela definição da versão e usa o horário da resposta parcial", () => {
    const definition = createEmptyMarketingFormDefinition();
    definition.questions.push({
      stableKey: "investimento", title: question, position: 1, type: "SINGLE_CHOICE", required: true,
      config: { options: [{ stableKey: "opcao-1", label: "Não" }, { stableKey: "opcao-2", label: "Sim" }] },
    });
    const answeredAt = new Date("2026-11-11T12:00:00Z");
    const answers = [{ questionKey: "investimento", value: "opcao-1", answeredAt: answeredAt.toISOString() }];
    expect(marketingFormBudgetObservation(definition, answers, observedAt, false)).toEqual({
      tag: "SEM BUDGET", observedAt: answeredAt, finalized: false,
    });
    definition.questions[definition.questions.length - 1] = {
      stableKey: "investimento", title: "Quanto você estaria disposto a investir mensalmente?", position: 1,
      type: "SINGLE_CHOICE", required: true, config: {
        options: [{ stableKey: "opcao-1", label: "De R$ 300 a R$ 500" }, { stableKey: "opcao-2", label: "De R$ 500 a R$ 1.000" }],
      },
    };
    expect(marketingFormBudgetObservation(definition, answers, observedAt, true)?.tag).toBe("YELLOW BUDGET");
  });
});
