import { workspaceDateAt } from "@/shared/core/time/workspace-time";
import type { CashMovement } from "./finance-reporting";

export function dashboardMonths(from: Date, timeZone: string) {
  const [year, month] = workspaceDateAt(from, timeZone).split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) =>
    new Date(Date.UTC(year!, month! - 6 + index, 1)).toISOString().slice(0, 7),
  );
}

export function dashboardCashHistory(months: string[], to: Date, movements: CashMovement[], timeZone: string) {
  const byMonth = new Map<string, { income: bigint; expense: bigint; gross: bigint }>();
  const includedMonths = new Set(months);
  for (const movement of movements) {
    if (movement.at >= to || movement.balanceKind) continue;
    const month = workspaceDateAt(movement.at, timeZone).slice(0, 7);
    if (!includedMonths.has(month)) continue;
    const totals = byMonth.get(month) ?? { income: 0n, expense: 0n, gross: 0n };
    if (movement.direction === "INCOME") totals.income += movement.amountCents;
    else {
      totals.expense += movement.amountCents;
      if (movement.amountCents > 0n) totals.gross += movement.amountCents;
    }
    byMonth.set(month, totals);
  }
  return months.map((month) => {
    const totals = byMonth.get(month);
    return {
      month,
      incomeCents: totals?.income.toString() ?? null,
      expenseCents: totals?.expense.toString() ?? null,
      grossCents: totals?.gross.toString() ?? null,
      resultCents: totals ? (totals.income - totals.expense).toString() : null,
    };
  });
}

export type DashboardTitle = { id: string; name: string; due: string; amount: bigint };

export function dashboardDueTitles(titles: DashboardTitle[], today: string, through: string) {
  const overdue = titles.filter((title) => title.due < today);
  const upcoming = titles.filter((title) => title.due >= today && title.due < through)
    .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name, "pt-BR"));
  const total = (rows: DashboardTitle[]) => rows.reduce((sum, row) => sum + row.amount, 0n).toString();
  return {
    openCents: total(titles),
    openCount: titles.length,
    overdueCents: total(overdue),
    upcomingCents: total(upcoming),
    upcomingCount: upcoming.length,
    items: upcoming.slice(0, 4).map(({ id, name, due, amount }) => ({ id, name, due, cents: amount.toString() })),
  };
}
