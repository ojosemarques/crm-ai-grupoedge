import { describe, expect, it } from "vitest";

import {
  leadEntryFieldsSchema,
  parseBrlToCents,
  parseCsvBoolean,
} from "@/modules/leads/domain/lead-entry-contracts";

describe("contratos dos canais de entrada", () => {
  it("preserva UTM e versão da oferta sem converter a entrada em negócio", () => {
    const parsed = leadEntryFieldsSchema.parse({ fullName: "Contato institucional", phone: "+5511999999999", sourceKey: "landing", priorityBandCode: "P2", acquisition: { utmSource: "meta", utmMedium: "paid", utmCampaign: "mandato" }, requestedOffer: { catalogItemId: "11111111-1111-4111-8111-111111111111", version: 2 } });
    expect(parsed.acquisition).toMatchObject({ utmSource: "meta", utmCampaign: "mandato" });
    expect(parsed.requestedOffer).toEqual({ catalogItemId: "11111111-1111-4111-8111-111111111111", version: 2 });
  });
  it.each([
    ["40", 4_000],
    ["6,50", 650],
    ["R$ 1.234,56", 123_456],
    ["6500.00", 650_000],
  ])("converte %s reais em centavos", (value, expected) => {
    expect(parseBrlToCents(value)).toBe(expected);
  });

  it("rejeita moeda ambígua ou fora do contrato", () => {
    expect(() => parseBrlToCents("R$ seis mil")).toThrow("Informe o orçamento");
  });

  it.each([
    ["sim", true],
    ["não", false],
    ["TRUE", true],
    ["0", false],
    ["", undefined],
  ])("interpreta booleano CSV %s", (value, expected) => {
    expect(parseCsvBoolean(value)).toBe(expected);
  });

  it("separa ausência de dado de restrição de contato", () => {
    const parsed = leadEntryFieldsSchema.parse({
      fullName: "Pessoa Fictícia",
      phone: "11987654321",
      email: "",
      stateCode: "",
      sourceKey: "manual",
      priorityBandCode: "P3",
    });

    expect(parsed.email).toBeUndefined();
    expect(parsed.stateCode).toBeUndefined();
    expect(parsed.doNotContact).toBeUndefined();
  });

  it("reporta orçamento inválido como erro de campo do canal", () => {
    const parsed = leadEntryFieldsSchema.safeParse({
      fullName: "Pessoa Fictícia",
      phone: "11987654321",
      budgetBrl: "seis mil",
      sourceKey: "manual",
      priorityBandCode: "P3",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ["budgetBrl"],
          message: "Informe o orçamento em reais, por exemplo 6500,00.",
        }),
      ]);
    }
  });
});
