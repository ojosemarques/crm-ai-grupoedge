import { describe, expect, it } from "vitest";
import { buildDre, dailyCashFlow } from "./finance-reporting";

describe("finance reporting", () => {
  it("agrupa caixa no dia civil do workspace sem criar um dia extra no fim do mês", () => {
    const rows = dailyCashFlow(new Date("2026-09-01T03:00:00Z"), new Date("2026-10-01T03:00:00Z"), 0n, [
      { at: new Date("2026-09-02T02:59:00Z"), direction: "INCOME", amountCents: 100n },
      { at: new Date("2026-10-01T02:59:00Z"), direction: "INCOME", amountCents: 200n },
      { at: new Date("2026-10-01T03:00:00Z"), direction: "INCOME", amountCents: 900n },
    ], "America/Sao_Paulo");
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ bucket: "2026-09-01", incomeCents: "100" });
    expect(rows.at(-1)).toMatchObject({ bucket: "2026-09-30", incomeCents: "200", balanceCents: "300" });
  });
  it("preserva saldo anterior e dias sem movimento, sem incluir o próximo período", () => {
    const rows = dailyCashFlow(new Date("2026-09-01"), new Date("2026-09-04"), 10_000n, [
      { at: new Date("2026-08-31"), direction: "INCOME", amountCents: 99_000n },
      { at: new Date("2026-09-01"), direction: "INCOME", amountCents: 5_000n },
      { at: new Date("2026-09-03"), direction: "EXPENSE", amountCents: 2_000n },
      { at: new Date("2026-09-04"), direction: "EXPENSE", amountCents: 99_000n },
    ]);
    expect(rows.map((row) => row.balanceCents)).toEqual(["15000", "15000", "13000"]);
    expect(rows[1]).toMatchObject({ incomeCents: "0", expenseCents: "0", resultCents: "0" });
  });

  it("separa deduções, custos diretos, despesas e resultado financeiro na DRE", () => {
    const result = buildDre([
      { categoryId: "sales", category: "Vendas", group: "receita_bruta", direction: "INCOME", amountCents: 100_000n },
      { categoryId: "tax", category: "Impostos", group: "deducoes", direction: "EXPENSE", amountCents: 10_000n },
      { categoryId: "cost", category: "Entrega", group: "custos_diretos", direction: "EXPENSE", amountCents: 20_000n },
      { categoryId: "rent", category: "Aluguel", group: null, direction: "EXPENSE", amountCents: 15_000n },
      { categoryId: "interest", category: "Rendimentos", group: "resultado_financeiro", direction: "INCOME", amountCents: 1_000n },
    ]);
    expect(result.netRevenue).toBe(90_000n);
    expect(result.grossProfit).toBe(70_000n);
    expect(result.netIncome).toBe(56_000n);
    expect(result.lines.find((row) => row.categoryId === "group:despesas_operacionais")).toMatchObject({ resultCents: "-15000", total: true });
  });

  it("preserva grupos cadastrados com rótulos anteriores", () => {
    const result = buildDre([
      { categoryId: "sales", category: "Receitas", group: "Receita bruta", direction: "INCOME", amountCents: 10000n },
      { categoryId: "cost", category: "Custo", group: "Custos diretos", direction: "EXPENSE", amountCents: 1000n },
      { categoryId: "ops", category: "Operação", group: "OPERATING_EXPENSE", direction: "EXPENSE", amountCents: 2000n },
    ]);
    expect(result.grossProfit).toBe(9000n);
    expect(result.netIncome).toBe(7000n);
  });
});
