import { describe, expect, it } from "vitest";

import { createEmptyMarketingFormDefinition, marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";

describe("contrato de formulários de marketing", () => {
  it("produz um rascunho inicial válido", () => {
    expect(createEmptyMarketingFormDefinition()).toMatchObject({ schema: "marketing-form.v1", questions: [{ mapping: "fullName" }] });
  });

  it("rejeita chaves, posições e mappings duplicados", () => {
    const definition = createEmptyMarketingFormDefinition();
    const duplicate = { ...definition.questions[0]!, title: "Outro nome" };
    expect(marketingFormDefinitionSchema.safeParse({ ...definition, questions: [definition.questions[0], duplicate] }).success).toBe(false);
  });

  it("rejeita URLs não HTTPS e redirects incompletos", () => {
    const definition = createEmptyMarketingFormDefinition();
    expect(marketingFormDefinitionSchema.safeParse({ ...definition, style: { ...definition.style, logoUrl: "http://127.0.0.1/logo.png" } }).success).toBe(false);
    expect(marketingFormDefinitionSchema.safeParse({ ...definition, redirects: { automaticKind: "URL" } }).success).toBe(false);
  });

  it("rejeita opção duplicada e limites incoerentes", () => {
    const definition = createEmptyMarketingFormDefinition();
    const question = { stableKey: "interesses", type: "MULTIPLE_CHOICE", title: "Interesses", required: false, position: 1, config: { options: [{ stableKey: "um", label: "Um" }, { stableKey: "um", label: "Outro" }], minSelections: 2, maxSelections: 1 } };
    expect(marketingFormDefinitionSchema.safeParse({ ...definition, questions: [...definition.questions, question] }).success).toBe(false);
  });
});
