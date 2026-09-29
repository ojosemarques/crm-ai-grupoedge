import { describe, expect, it } from "vitest";
import { normalizedMrr, reconstructMrr } from "@/modules/revenue/domain/revenue-contracts";

describe("revenue ledger", () => {
  it("normaliza mensal, trimestral e anual em centavos", () => {
    expect(normalizedMrr(2, 1000n, "MONTHLY")).toBe(2000n);
    expect(normalizedMrr(1, 1000n, "QUARTERLY")).toBe(333n);
    expect(normalizedMrr(1, 1000n, "ANNUAL")).toBe(83n);
  });
  it("reconstrói MRR por data efetiva e desempata por sequência", () => {
    const at = new Date("2026-09-01T12:00:00Z");
    expect(reconstructMrr([{deltaMrrCents:100n,effectiveAt:at,sequence:1},{deltaMrrCents:-20n,effectiveAt:at,sequence:2},{deltaMrrCents:50n,effectiveAt:new Date("2026-10-01T00:00:00Z"),sequence:3}], at)).toBe(80n);
  });
});
