import { describe, expect, it } from "vitest";

import { normalizeAccountName, normalizeDocument, normalizeDomain } from "@/modules/accounts/application/account-service";

describe("identidade canônica de contas", () => {
  it("normaliza nome, documento e domínio sem inventar vínculos", () => {
    expect(normalizeAccountName("  Instituto  São João  ")).toBe("instituto sao joao");
    expect(normalizeDocument("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeDomain("https://www.Exemplo.COM.br/pagina")).toBe("exemplo.com.br");
  });

  it("preserva ausência como ausência", () => {
    expect(normalizeDocument(null)).toBeNull();
    expect(normalizeDomain("  ")).toBeNull();
  });
});
