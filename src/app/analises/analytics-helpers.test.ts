import { describe, expect, it } from "vitest";
import { chartScale, formatMetric, widgetCsv } from "./analytics-helpers";
import type { AnalyticsWidget } from "./analytics-types";

describe("helpers de análises", () => {
  it("normaliza pontos sem divisão por zero", () => { expect(chartScale([{ key: "a", label: "A", value: 5 }])).toEqual([{ x: 50, y: 12 }]); expect(chartScale([])).toEqual([]); });
  it("formata moeda em centavos", () => { expect(formatMetric(125050, "CURRENCY")).toContain("1.251"); });
  it("gera CSV compatível com Excel e escapa células", () => { const widget = { id: "w", title: "Receita; líquida", type: "BAR", metricKey: "revenue", metricLabel: "Receita", aggregation: "SUM", dateBasis: "createdAt", period: { preset: "MONTH" }, filters: [], state: "DATA", points: [{ key: "1", label: "Equipe A", value: 10 }] } satisfies AnalyticsWidget; const csv = widgetCsv(widget); expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain('"Receita; líquida"'); expect(csv).toContain("Equipe A;10"); });
});
