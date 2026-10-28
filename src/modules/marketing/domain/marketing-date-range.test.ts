import { describe, expect, it } from "vitest";
import { marketingDateRanges } from "./marketing-date-range";

describe("atalhos de período de marketing", () => {
  it("inclui o dia atual nos últimos 7 e 30 dias e usa o início do mês", () => {
    expect(marketingDateRanges("2026-10-28")).toEqual({ TODAY: { from: "2026-10-28", to: "2026-10-28" }, YESTERDAY: { from: "2026-10-27", to: "2026-10-27" }, LAST_7_DAYS: { from: "2026-10-22", to: "2026-10-28" }, MONTH: { from: "2026-10-01", to: "2026-10-28" }, LAST_30_DAYS: { from: "2026-09-29", to: "2026-10-28" } });
  });
  it("atravessa ano e fevereiro bissexto sem alterar a duração inclusiva", () => {
    expect(marketingDateRanges("2027-01-01").YESTERDAY).toEqual({ from: "2026-12-31", to: "2026-12-31" });
    expect(marketingDateRanges("2028-03-01").LAST_7_DAYS).toEqual({ from: "2028-02-24", to: "2028-03-01" });
  });
});
