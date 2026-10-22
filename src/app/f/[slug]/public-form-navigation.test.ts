import { describe, expect, it } from "vitest";

import { shouldAutoAdvanceSingleChoice } from "@/app/f/[slug]/public-form-navigation";

describe("shouldAutoAdvanceSingleChoice", () => {
  it("avança escolhas únicas quando existe uma próxima pergunta", () => {
    expect(shouldAutoAdvanceSingleChoice("SINGLE_CHOICE", 1, 7)).toBe(true);
  });

  it("mantém a última escolha única na tela para o envio explícito", () => {
    expect(shouldAutoAdvanceSingleChoice("SINGLE_CHOICE", 6, 7)).toBe(false);
  });

  it("não avança automaticamente outros tipos de pergunta", () => {
    expect(shouldAutoAdvanceSingleChoice("MULTIPLE_CHOICE", 1, 7)).toBe(false);
    expect(shouldAutoAdvanceSingleChoice("DROPDOWN", 1, 7)).toBe(false);
  });
});
