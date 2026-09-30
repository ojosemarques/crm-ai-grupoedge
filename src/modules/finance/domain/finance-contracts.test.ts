import { describe, expect, it } from "vitest";
import {
  commissionAmountCents,
  createFinancialEntrySchema,
  financeQuerySchema,
  nextCommissionStatus,
} from "./finance-contracts";

describe("finance domain", () => {
  it("calcula comissão em basis points com arredondamento de centavo", () => {
    expect(commissionAmountCents(10_001n, 250)).toBe(250n);
    expect(commissionAmountCents(10_020n, 250)).toBe(251n);
  });

  it("mantém aprovação antes do pagamento", () => {
    expect(nextCommissionStatus("PENDING", "APPROVED")).toBe("APPROVED");
    expect(nextCommissionStatus("PENDING", "PAID")).toBeNull();
    expect(nextCommissionStatus("APPROVED", "PAID")).toBe("PAID");
  });

  it("exige data de realização somente no lançamento realizado", () => {
    const base = {
      action: "CREATE_ENTRY",
      categoryId: "00000000-0000-4000-8000-000000000001",
      financialAccountId: "00000000-0000-4000-8000-000000000002",
      direction: "EXPENSE",
      description: "Despesa operacional",
      amountCents: 1_000,
      competenceAt: "2026-09-01T00:00:00.000Z",
      dueAt: "2026-09-10T00:00:00.000Z",
      idempotencyKey: "finance:test:entry:1",
    } as const;
    expect(() => createFinancialEntrySchema.parse({ ...base, status: "SETTLED" })).toThrow("Informe a data");
    expect(createFinancialEntrySchema.parse({ ...base, status: "PLANNED" }).amountCents).toBe(1_000n);
  });

  it("rejeita período invertido", () => {
    expect(() => financeQuerySchema.parse({ from: "2026-10-01", to: "2026-09-01" })).toThrow("posterior");
  });
});
