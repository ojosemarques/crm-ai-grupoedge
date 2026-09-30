export type CashMovement = Readonly<{ at: Date; direction: "INCOME" | "EXPENSE"; amountCents: bigint }>;

/** UTC matches the competence and date-only values persisted by the finance forms. */
export function dailyCashFlow(from: Date, to: Date, openingBalanceCents: bigint, movements: readonly CashMovement[]) {
  const grouped = new Map<string, { income: bigint; expense: bigint }>();
  for (const movement of movements) {
    if (movement.at < from || movement.at >= to) continue;
    const key = movement.at.toISOString().slice(0, 10);
    const row = grouped.get(key) ?? { income: 0n, expense: 0n };
    if (movement.direction === "INCOME") row.income += movement.amountCents;
    else row.expense += movement.amountCents;
    grouped.set(key, row);
  }
  let balance = openingBalanceCents;
  const rows = [];
  for (let at = new Date(from); at < to; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1))) {
    const bucket = at.toISOString().slice(0, 10);
    const row = grouped.get(bucket) ?? { income: 0n, expense: 0n };
    balance += row.income - row.expense;
    rows.push({ bucket, label: `${bucket.slice(8)}/${bucket.slice(5, 7)}`, incomeCents: row.income.toString(), expenseCents: row.expense.toString(), resultCents: (row.income - row.expense).toString(), balanceCents: balance.toString() });
  }
  return rows;
}

export const dreGroups = [
  { key: "receita_bruta", label: "Receita bruta" },
  { key: "deducoes", label: "Deduções da receita" },
  { key: "custos_diretos", label: "Custos diretos" },
  { key: "despesas_operacionais", label: "Despesas operacionais" },
  { key: "resultado_financeiro", label: "Resultado financeiro" },
  { key: "impostos_resultado", label: "Impostos sobre resultado" },
] as const;

type DreMovement = Readonly<{ categoryId: string; category: string; group: string | null; direction: "INCOME" | "EXPENSE"; amountCents: bigint }>;
function groupKey(item: DreMovement) {
  if (!item.group) return item.direction === "INCOME" ? "receita_bruta" : "despesas_operacionais";
  const normalized = item.group.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "_");
  const aliases: Record<string, string> = { operating_expense: "despesas_operacionais", direct_costs: "custos_diretos", gross_revenue: "receita_bruta", revenue_deductions: "deducoes", deducoes_da_receita: "deducoes", financial_result: "resultado_financeiro", impostos_sobre_resultado: "impostos_resultado" };
  return aliases[normalized] ?? (dreGroups.some((group) => group.key === normalized) ? normalized : item.group);
}

export function buildDre(movements: readonly DreMovement[]) {
  const groups = new Map<string, Map<string, { category: string; income: bigint; expense: bigint }>>();
  for (const item of movements) {
    const group = groupKey(item);
    const categories = groups.get(group) ?? new Map();
    const row = categories.get(item.categoryId) ?? { category: item.category, income: 0n, expense: 0n };
    if (item.direction === "INCOME") row.income += item.amountCents; else row.expense += item.amountCents;
    categories.set(item.categoryId, row);
    groups.set(group, categories);
  }
  const ordered = [...dreGroups.map((group) => group.key), ...[...groups.keys()].filter((key) => !dreGroups.some((group) => group.key === key))];
  let revenue = 0n, expense = 0n, operatingRevenue = 0n, deductions = 0n, directCosts = 0n;
  const lines: Array<{ categoryId: string; category: string; group: string; incomeCents: string; expenseCents: string; resultCents: string; total?: boolean }> = [];
  for (const group of ordered) {
    const categories = groups.get(group);
    if (!categories) continue;
    let groupIncome = 0n, groupExpense = 0n;
    for (const [categoryId, row] of categories) {
      groupIncome += row.income; groupExpense += row.expense;
      lines.push({ categoryId, category: row.category, group, incomeCents: row.income.toString(), expenseCents: row.expense.toString(), resultCents: (row.income - row.expense).toString() });
    }
    revenue += groupIncome; expense += groupExpense;
    if (group === "receita_bruta") operatingRevenue += groupIncome - groupExpense;
    else if (!dreGroups.some((item) => item.key === group)) operatingRevenue += groupIncome;
    if (group === "deducoes") deductions += groupExpense - groupIncome;
    if (group === "custos_diretos") directCosts += groupExpense - groupIncome;
    lines.push({ categoryId: `group:${group}`, category: dreGroups.find((item) => item.key === group)?.label ?? group, group, incomeCents: groupIncome.toString(), expenseCents: groupExpense.toString(), resultCents: (groupIncome - groupExpense).toString(), total: true });
  }
  lines.push({ categoryId: "net-result", category: "Resultado líquido", group: "resultado", incomeCents: revenue.toString(), expenseCents: expense.toString(), resultCents: (revenue - expense).toString(), total: true });
  return { lines, revenue, expense, netRevenue: operatingRevenue - deductions, grossProfit: operatingRevenue - deductions - directCosts, netIncome: revenue - expense };
}
