import type { RevenueMetricDefinition } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { dashboardPeriodPresets } from "@/modules/metrics/domain/dashboard-contracts";
import { getRevenueMetricDefinition, revenueMetricRegistry } from "@/modules/metrics/domain/revenue-metric-registry";
import { z } from "zod";

export const analyticsWidgetTypes = ["LINE", "AREA", "BAR", "PIE", "DONUT", "FUNNEL", "TABLE", "NUMBER", "KPI"] as const;
export const analyticsAggregations = ["SUM", "AVERAGE", "COUNT", "RATE", "LATEST"] as const;
export const analyticsQualityStates = ["AVAILABLE", "ZERO", "PARTIAL", "MISSING", "DELAYED", "SUPPRESSED"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filtersSchema = z.object({
  sdr: z.array(z.string().uuid()).max(100).default([]), closer: z.array(z.string().uuid()).max(100).default([]),
  team: z.array(z.string().uuid()).max(100).default([]), source: z.array(z.string().max(160)).max(100).default([]),
  campaign: z.array(z.string().max(160)).max(100).default([]), creative: z.array(z.string().max(160)).max(100).default([]),
  priority: z.array(z.enum(["P1", "P2", "P3"])).max(3).default([]), product: z.array(z.string().uuid()).max(100).default([]),
}).strict().default({ sdr: [], closer: [], team: [], source: [], campaign: [], creative: [], priority: [], product: [] });

export const analyticsWidgetInputSchema = z.object({
  id: z.string().uuid().optional(), title: z.string().trim().min(1).max(160),
  metricKey: z.string().min(3).max(100), type: z.enum(analyticsWidgetTypes), aggregation: z.enum(analyticsAggregations),
  dimensionKey: z.string().min(1).max(100).nullable().default(null), dateBasis: z.string().min(1).max(200),
  period: z.object({ preset: z.enum(dashboardPeriodPresets), fromDate: isoDate.nullable().default(null), toDate: isoDate.nullable().default(null) }).strict(),
  asOf: z.string().datetime({ offset: true }).nullable().default(null), filters: filtersSchema,
  position: z.object({ x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(10_000), width: z.number().int().min(1).max(100), height: z.number().int().min(1).max(100) }).strict().default({ x: 0, y: 0, width: 6, height: 4 }),
  expectedRevision: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (value.period.preset === "CUSTOM" && (!value.period.fromDate || !value.period.toDate || value.period.fromDate > value.period.toDate)) context.addIssue({ code: "custom", message: "Período personalizado inválido.", path: ["period"] });
  if (value.period.preset !== "CUSTOM" && (value.period.fromDate || value.period.toDate)) context.addIssue({ code: "custom", message: "Datas explícitas só são aceitas no período personalizado.", path: ["period"] });
});

export const createAnalyticsDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).default(""),
  widgets: z.array(analyticsWidgetInputSchema).max(40).default([]), idempotencyKey: z.string().trim().min(8).max(160),
}).strict();

export const updateAnalyticsDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).default(""),
  widgets: z.array(analyticsWidgetInputSchema).max(40), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().trim().min(8).max(160),
}).strict();

const timeSeriesMetrics = new Set(["revenue.closing_mrr", "revenue.net_new_mrr", "sales.bookings", "cash.received", "sales.leads"]);
const dimensionalTypes = new Set(["BAR", "PIE", "DONUT", "FUNNEL"]);

export function validateWidgetCompatibility(widget: z.infer<typeof analyticsWidgetInputSchema>): RevenueMetricDefinition {
  const metric = getRevenueMetricDefinition(widget.metricKey);
  if (!metric) throw new Error("Métrica não registrada.");
  if (!metric.supportedDateBases.includes(widget.dateBasis)) throw new Error("Data-base incompatível com a métrica.");
  if (widget.dimensionKey && !metric.supportedDimensions.includes(widget.dimensionKey)) throw new Error("Dimensão incompatível com a métrica.");
  if (dimensionalTypes.has(widget.type) && !widget.dimensionKey) throw new Error("A visualização exige uma dimensão.");
  if ((dimensionalTypes.has(widget.type) || widget.type === "TABLE") && widget.metricKey !== "sales.opportunity_value") throw new Error("A visualização tabular ou dimensional exige uma métrica com dataset materializado.");
  if ((widget.type === "NUMBER" || widget.type === "KPI" || widget.type === "LINE" || widget.type === "AREA") && widget.dimensionKey) throw new Error("A visualização não aceita dimensão.");
  if ((widget.type === "LINE" || widget.type === "AREA") && !timeSeriesMetrics.has(widget.metricKey)) throw new Error("A métrica não possui série temporal homologada.");
  if (widget.aggregation === "RATE" && metric.unit !== "BASIS_POINTS") throw new Error("A agregação RATE exige uma métrica de taxa.");
  if (widget.metricKey === "sales.opportunity_value" && [widget.filters.sdr, widget.filters.source, widget.filters.campaign, widget.filters.creative, widget.filters.priority].some((values) => values.length > 0)) throw new Error("A métrica de oportunidades aceita somente filtros de closer, equipe e produto.");
  return metric;
}

export function analyticsCatalog() {
  return Object.freeze({
    metrics: revenueMetricRegistry.map((metric) => ({ metricKey: metric.id, label: metric.name, description: metric.description, unit: metric.unit, dimensions: metric.supportedDimensions, dateBasis: metric.factTimestamp, dateBases: metric.supportedDateBases, version: metric.version })),
    dimensions: [...new Set(revenueMetricRegistry.flatMap((metric) => metric.supportedDimensions))].sort().map((key) => ({ key, label: key })),
    dateBases: [...new Set(revenueMetricRegistry.flatMap((metric) => metric.supportedDateBases))].sort().map((key) => ({ key, label: key })),
    filterFields: ["sdr", "closer", "team", "source", "campaign", "creative", "priority", "product"],
    aggregations: analyticsAggregations,
    widgetTypes: analyticsWidgetTypes,
  });
}

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function recordsCsv(records: readonly Record<string, unknown>[]): string {
  const columns = ["key", "entityType", "entityId", "title", "subtitle", "occurredAt", "contribution", "unit", "href", "provenance"];
  return `\uFEFF${[columns.map(csvCell).join(","), ...records.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n")}\r\n`;
}
