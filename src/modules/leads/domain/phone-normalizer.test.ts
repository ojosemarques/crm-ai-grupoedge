import { describe, expect, it } from "vitest";

import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";

describe("normalizePhone", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11 98765 4321", "+5511987654321"],
    ["+55 (11) 98765-4321", "+5511987654321"],
    ["55 11 98765-4321", "+5511987654321"],
    ["011 98765-4321", "+5511987654321"],
    ["021 11 98765-4321", "+5511987654321"],
    ["11 3456-7890", "+551134567890"],
  ])("normaliza a máscara brasileira %s", (input, expected) => {
    expect(normalizePhone(input)).toMatchObject({
      success: true,
      normalizedPhone: expected,
      countryCode: "55",
    });
  });

  it("preserva um número internacional explicitamente informado", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toMatchObject({
      success: true,
      normalizedPhone: "+14155552671",
    });
  });

  it("não inventa DDD nem país para número curto", () => {
    expect(normalizePhone("98765-4321")).toEqual({
      success: false,
      code: "PHONE_AMBIGUOUS",
      message:
        "O telefone brasileiro precisa incluir DDD; números internacionais precisam começar com + ou 00.",
    });
  });

  it("rejeita ramal ou conteúdo alfabético em vez de removê-lo", () => {
    expect(normalizePhone("11 98765-4321 ramal 2")).toMatchObject({
      success: false,
      code: "PHONE_INVALID",
    });
  });
});
