import { describe, expect, it } from "vitest";
import { dashboardCashHistory, dashboardDueTitles, dashboardMonths } from "./finance-dashboard";

describe("finance dashboard", () => {
  it("agrupa por mês local, mantém meses sem registros e calcula saídas líquidas", () => {
    const zone = "America/Sao_Paulo";
    const months = dashboardMonths(new Date("2026-01-01T03:00:00Z"), zone);
    expect(months).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
    const history = dashboardCashHistory(months, new Date("2026-01-13T03:00:00Z"), [
      { at: new Date("2026-01-01T02:59:00Z"), direction: "INCOME", amountCents: 200n },
      { at: new Date("2026-01-01T03:00:00Z"), direction: "EXPENSE", amountCents: 150n },
      { at: new Date("2026-01-02T03:00:00Z"), direction: "EXPENSE", amountCents: -20n },
      { at: new Date("2026-01-03T03:00:00Z"), direction: "EXPENSE", amountCents: 300n, balanceKind: "TRANSFER" },
      { at: new Date("2026-01-13T03:00:00Z"), direction: "INCOME", amountCents: 500n },
    ], zone);
    expect(history[3]).toMatchObject({ incomeCents: null, resultCents: null });
    expect(history[4]).toMatchObject({ incomeCents: "200", resultCents: "200" });
    expect(history[5]).toMatchObject({ incomeCents: "0", expenseCents: "130", grossCents: "150", resultCents: "-130" });
  });

  it("distingue títulos vencidos, próximos vencimentos e total em aberto", () => {
    const dateAmounts = [["2026-11-19", 500n], ["2026-11-15", 350n], ["2026-11-11", 300n], ["2026-11-12", 100n]] as const;
    const result = dashboardDueTitles(dateAmounts.map(([due, amount]) => ({ id: due, name: due, due, amount })), "2026-11-12", "2026-11-19");
    expect(result).toMatchObject({ openCents: "1250", overdueCents: "300", upcomingCents: "450", upcomingCount: 2 });
    expect(result.items.map((item) => item.due)).toEqual(["2026-11-12", "2026-11-15"]);
  });
});
