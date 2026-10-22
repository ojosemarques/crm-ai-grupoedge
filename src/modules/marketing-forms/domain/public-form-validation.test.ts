import { describe, expect, it } from "vitest";

import { createEmptyMarketingFormDefinition, marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { publicFormEventSchema } from "@/modules/marketing-forms/domain/public-form-contracts";
import { formatBrazilianMobilePhone } from "@/modules/marketing-forms/domain/brazilian-mobile-phone";
import { mapAnswersToLead, validatePublicFormAnswers } from "@/modules/marketing-forms/domain/public-form-validation";

function definition() {
  const base = createEmptyMarketingFormDefinition();
  return marketingFormDefinitionSchema.parse({
    ...base,
    questions: [
      base.questions[0]!,
      { stableKey: "telefone", type: "PHONE" as const, title: "Telefone", required: true, position: 1, mapping: "phone" as const, config: { defaultCountry: "BR" } },
      { stableKey: "interesse", type: "SINGLE_CHOICE" as const, title: "Interesse", required: true, position: 2, config: { options: [{ stableKey: "crm", label: "CRM" }, { stableKey: "site", label: "Site" }] } },
    ],
  });
}

describe("validação pública de respostas", () => {
  it("formata e limita WhatsApp brasileiro a DDD mais celular", () => {
    expect(formatBrazilianMobilePhone("62")).toBe("(62");
    expect(formatBrazilianMobilePhone("62985796723")).toBe("(62)98579-6723");
    expect(formatBrazilianMobilePhone("+55 62 98579-6723")).toBe("(62)98579-6723");
    expect(formatBrazilianMobilePhone("629857967231234")).toBe("(62)98579-6723");
  });

  it("reserva eventos de conclusão para o servidor", () => {
    const input = {
      versionPublicId: crypto.randomUUID(),
      sessionPublicId: crypto.randomUUID(),
      tracking: {},
      events: [{ eventId: crypto.randomUUID(), kind: "FORM_COMPLETED", occurredAt: new Date().toISOString() }],
    };
    expect(publicFormEventSchema.safeParse(input).success).toBe(false);
  });

  it("ordena pelo snapshot e mapeia apenas campos canônicos", () => {
    const current = definition();
    const answers = validatePublicFormAnswers(current, [
      { questionKey: "interesse", value: "crm" },
      { questionKey: "telefone", value: "+5511999999999" },
      { questionKey: "nome-completo", value: "Pessoa Teste" },
    ]);
    expect(answers.map((answer) => answer.questionKey)).toEqual(["nome-completo", "telefone", "interesse"]);
    expect(mapAnswersToLead(current, answers)).toEqual({ fullName: "Pessoa Teste", phone: "+5511999999999" });
  });

  it("rejeita nome curto e telefone sem DDD antes de encaminhar ao intake", () => {
    const current = definition();
    const baseAnswers = [
      { questionKey: "interesse", value: "crm" },
    ];

    expect(() => validatePublicFormAnswers(current, [
      { questionKey: "nome-completo", value: "A" },
      { questionKey: "telefone", value: "+5511999999999" },
      ...baseAnswers,
    ])).toThrowError("Informe um nome com pelo menos 2 caracteres.");

    expect(() => validatePublicFormAnswers(current, [
      { questionKey: "nome-completo", value: "Pessoa Teste" },
      { questionKey: "telefone", value: "98765-4321" },
      ...baseAnswers,
    ])).toThrowError("Informe um WhatsApp com DDD e 11 dígitos");

    expect(() => validatePublicFormAnswers(current, [
      { questionKey: "nome-completo", value: "Pessoa Teste" },
      { questionKey: "telefone", value: "(62)3579-6723" },
      ...baseAnswers,
    ])).toThrowError("Informe um WhatsApp com DDD e 11 dígitos");

    expect(() => validatePublicFormAnswers(current, [
      { questionKey: "nome-completo", value: "Pessoa Teste" },
      { questionKey: "telefone", value: "629857967231234" },
      ...baseAnswers,
    ])).toThrowError("Informe um WhatsApp com DDD e 11 dígitos");

    expect(() => validatePublicFormAnswers(current, [
      { questionKey: "nome-completo", value: "Pessoa Teste" },
      { questionKey: "telefone", value: "telefone (62)98579-6723" },
      ...baseAnswers,
    ])).toThrowError("Informe um WhatsApp com DDD e 11 dígitos");
  });

  it("rejeita pergunta, opção e duplicata não pertencentes à versão", () => {
    const current = definition();
    expect(() => validatePublicFormAnswers(current, [{ questionKey: "nome-completo", value: "Pessoa" }, { questionKey: "telefone", value: "+5511999999999" }, { questionKey: "interesse", value: "outro" }])).toThrow();
    expect(() => validatePublicFormAnswers(current, [{ questionKey: "desconhecida", value: "x" }])).toThrow();
    expect(() => validatePublicFormAnswers(current, [{ questionKey: "nome-completo", value: "Pessoa" }, { questionKey: "nome-completo", value: "Outra" }])).toThrow();
  });

  it("rejeita data inexistente ou fora dos limites do snapshot", () => {
    const base = definition();
    const current = marketingFormDefinitionSchema.parse({
      ...base,
      questions: [...base.questions, { stableKey: "nascimento", type: "DATE", title: "Nascimento", required: true, position: 3, config: { min: "2000-01-01", max: "2020-12-31" } }],
    });
    const fixed = [
      { questionKey: "nome-completo", value: "Pessoa" },
      { questionKey: "telefone", value: "+5511999999999" },
      { questionKey: "interesse", value: "crm" },
    ];
    expect(() => validatePublicFormAnswers(current, [...fixed, { questionKey: "nascimento", value: "2020-02-30" }])).toThrow();
    expect(() => validatePublicFormAnswers(current, [...fixed, { questionKey: "nascimento", value: "1999-12-31" }])).toThrow();
    expect(validatePublicFormAnswers(current, [...fixed, { questionKey: "nascimento", value: "2020-02-29" }])).toHaveLength(4);
  });
});
