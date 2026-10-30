import { describe, expect, it } from "vitest";
import { resolveRealtimeDashboardPeriods } from "./realtime-dashboard-domain";
import { readRealtimePeriodQuery, realtimePeriodQuerySchema } from "./realtime-period-filter";

const timeZone = "America/Sao_Paulo";
const now = new Date("2026-10-30T01:30:00Z"); // Thursday in the workspace.

describe("filtro de período do Tempo Real", () => {
  it("mantém Hoje como padrão e preserva a semana operacional existente", () => {
    expect(readRealtimePeriodQuery(new URLSearchParams())).toEqual({ periodPreset: "TODAY", periodFrom: "", periodTo: "" });
    const periods = resolveRealtimeDashboardPeriods(now, timeZone);
    expect(periods.selection).toBeUndefined();
    expect(periods.today).toMatchObject({ from: "2026-10-29T03:00:00.000Z", to: now.toISOString() });
  });
  it("resolve ontem e semanas completas de segunda a domingo no fuso do workspace", () => {
    expect(resolveRealtimeDashboardPeriods(now, timeZone, { periodPreset: "YESTERDAY" }).today).toMatchObject({ from: "2026-10-28T03:00:00.000Z", to: "2026-10-29T03:00:00.000Z" });
    expect(resolveRealtimeDashboardPeriods(now, timeZone, { periodPreset: "THIS_WEEK" }).today).toMatchObject({ fromDate: "2026-10-26", toDate: "2026-11-01", to: now.toISOString() });
    expect(resolveRealtimeDashboardPeriods(now, timeZone, { periodPreset: "LAST_WEEK" }).today).toMatchObject({ from: "2026-10-19T03:00:00.000Z", to: "2026-10-26T03:00:00.000Z" });
  });
  it("inclui o dia final inteiro em um intervalo personalizado, inclusive na virada do ano", () => {
    expect(resolveRealtimeDashboardPeriods(now, timeZone, { periodPreset: "CUSTOM", periodFrom: "2025-12-31", periodTo: "2026-01-01" }).today).toMatchObject({ from: "2025-12-31T03:00:00.000Z", to: "2026-01-02T03:00:00.000Z" });
  });
  it("rejeita datas impossíveis, invertidas, ausentes e intervalos excessivos", () => {
    for (const query of [
      { periodPreset: "CUSTOM" }, { periodPreset: "INVALID" },
      { periodPreset: "CUSTOM", periodFrom: "2026-02-30", periodTo: "2026-03-01" },
      { periodPreset: "CUSTOM", periodFrom: "2026-10-30", periodTo: "2026-10-29" },
      { periodPreset: "CUSTOM", periodFrom: "2024-01-01", periodTo: "2026-10-29" },
    ]) expect(realtimePeriodQuerySchema.safeParse(query).success).toBe(false);
  });
});
