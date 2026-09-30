import { describe, expect, it } from "vitest";
import { analyticsCatalog, analyticsWidgetInputSchema, csvCell, recordsCsv, validateWidgetCompatibility } from "./analytics-builder-contracts";

const base = { title: "MRR", metricKey: "revenue.closing_mrr", type: "KPI" as const, aggregation: "LATEST" as const, dimensionKey: null, dateBasis: "effectiveAt", period: { preset: "MONTH" as const, fromDate: null, toDate: null }, asOf: null, filters: {}, position: { x: 0, y: 0, width: 6, height: 4 } };

describe("analytics builder contracts", () => {
  it("aceita widget coerente com o registry", () => { const parsed = analyticsWidgetInputSchema.parse(base); expect(validateWidgetCompatibility(parsed).id).toBe("revenue.closing_mrr"); });
  it("rejeita dimensão e série incompatíveis", () => {
    expect(() => validateWidgetCompatibility(analyticsWidgetInputSchema.parse({ ...base, type: "PIE", dimensionKey: null }))).toThrow("exige uma dimensão");
    expect(() => validateWidgetCompatibility(analyticsWidgetInputSchema.parse({ ...base, type: "LINE", metricKey: "retention.nrr", dateBasis: "effectiveAt" }))).toThrow("série temporal");
  });
  it("restringe e permite a troca de data-base declarada no registry", () => {
    const opportunity = { ...base, title: "Oportunidades", metricKey: "sales.opportunity_value", dateBasis: "CREATED_AT" };
    expect(validateWidgetCompatibility(analyticsWidgetInputSchema.parse(opportunity)).supportedDateBases).toEqual(["CREATED_AT", "WON_AT"]);
    expect(validateWidgetCompatibility(analyticsWidgetInputSchema.parse({ ...opportunity, dateBasis: "WON_AT" })).id).toBe("sales.opportunity_value");
    expect(() => validateWidgetCompatibility(analyticsWidgetInputSchema.parse({ ...opportunity, dateBasis: "closedAt" }))).toThrow("Data-base incompatível");
    expect(analyticsCatalog().dateBases.map((item) => item.key)).toEqual(expect.arrayContaining(["CREATED_AT", "WON_AT"]));
  });
  it("não aceita gráfico dimensional sem dataset materializado", () => {
    expect(() => validateWidgetCompatibility(analyticsWidgetInputSchema.parse({ ...base, metricKey: "revenue.closing_mrr", type: "BAR", dimensionKey: "equipe" }))).toThrow("dataset materializado");
  });
  it("neutraliza fórmulas e mantém ordem no CSV", () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("\"'=cmd|' /C calc'!A0\"");
    const csv = recordsCsv([{ key: "2", title: "segundo" }, { key: "1", title: "primeiro" }]);
    expect(csv.indexOf("segundo")).toBeLessThan(csv.indexOf("primeiro"));
  });
});
