import { describe, expect, it } from "vitest";

import { resolveProspectingMetricsPeriod } from "@/modules/prospecting/domain/prospecting-metrics-period";

const now = new Date("2026-10-09T15:30:00.000Z");
const timeZone = "America/Sao_Paulo";

describe("resolveProspectingMetricsPeriod", () => {
  it.each([
    ["TODAY", "2026-10-09", "2026-10-09", "2026-10-09T03:00:00.000Z", now.toISOString()],
    ["YESTERDAY", "2026-10-08", "2026-10-08", "2026-10-08T03:00:00.000Z", "2026-10-09T03:00:00.000Z"],
    ["LAST_7_DAYS", "2026-10-03", "2026-10-09", "2026-10-03T03:00:00.000Z", now.toISOString()],
    ["MONTH", "2026-10-01", "2026-10-09", "2026-10-01T03:00:00.000Z", now.toISOString()],
    ["LAST_30_DAYS", "2026-09-10", "2026-10-09", "2026-09-10T03:00:00.000Z", now.toISOString()],
  ] as const)("resolve o preset %s no fuso do workspace", (preset, fromDate, toDate, start, end) => {
    const result = resolveProspectingMetricsPeriod(preset, undefined, undefined, now, timeZone);

    expect(result).toMatchObject({ preset, fromDate, toDate, timeZone });
    expect(result.start.toISOString()).toBe(start);
    expect(result.end.toISOString()).toBe(end);
  });

  it("inclui integralmente os dias passados no período personalizado", () => {
    const result = resolveProspectingMetricsPeriod("CUSTOM", "2026-10-01", "2026-10-08", now, timeZone);

    expect(result.start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });

  it.each([
    ["2026-10-10", "2026-10-10", "futuro"],
    ["2026-10-08", "2026-10-01", "anterior"],
    ["2026-02-30", "2026-03-01", "válida"],
  ])("rejeita intervalo inválido de %s até %s", (fromDate, toDate, message) => {
    expect(() => resolveProspectingMetricsPeriod("CUSTOM", fromDate, toDate, now, timeZone)).toThrow(message);
  });
});
