import { describe, expect, it } from "vitest";

import { createEmptyMarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { summarizeMarketingFormAnswers } from "@/modules/marketing-forms/domain/marketing-form-response-summary";

describe("marketing form response summary", () => {
  it("preserva a ordem das perguntas e troca chaves de opções pelos rótulos", () => {
    const base = createEmptyMarketingFormDefinition();
    const definition = {
      ...base,
      questions: [
        base.questions[0]!,
        {
          stableKey: "cargo",
          type: "SINGLE_CHOICE" as const,
          title: "Qual é o seu cargo?",
          required: true,
          position: 1,
          mapping: "jobTitle" as const,
          config: { options: [{ stableKey: "prefeito", label: "Prefeito" }, { stableKey: "vereador", label: "Vereador" }] },
        },
      ],
    };
    expect(summarizeMarketingFormAnswers(JSON.parse(JSON.stringify(definition)), [
      { questionKey: "cargo", value: "vereador" },
      { questionKey: "nome-completo", value: "Maria Silva" },
    ])).toEqual([
      { questionKey: "nome-completo", question: "Qual o seu nome completo?", displayValue: "Maria Silva" },
      { questionKey: "cargo", question: "Qual é o seu cargo?", displayValue: "Vereador" },
    ]);
  });

  it("não expõe respostas quando o snapshot histórico é inválido", () => {
    expect(summarizeMarketingFormAnswers({}, [{ questionKey: "nome", value: "Pessoa" }])).toEqual([]);
  });
});
