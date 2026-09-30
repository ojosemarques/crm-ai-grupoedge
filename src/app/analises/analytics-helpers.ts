import type { AnalyticsWidget, WidgetPoint } from "./analytics-types";

export function formatMetric(value: number | null | undefined, unit: AnalyticsWidget["unit"] = "NUMBER"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "PERCENT") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (unit === "CURRENCY") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value / 100);
  if (unit === "DURATION") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function chartScale(points: readonly WidgetPoint[]): readonly Readonly<{ x: number; y: number }>[] {
  if (!points.length) return [];
  const values = points.map((point) => point.value); const min = Math.min(0, ...values); const max = Math.max(...values); const span = max - min || 1;
  return points.map((point, index) => ({ x: points.length === 1 ? 50 : (index / (points.length - 1)) * 100, y: 92 - ((point.value - min) / span) * 80 }));
}

function csvCell(value: unknown): string { const text = value === null || value === undefined ? "" : String(value); return /[";,\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
export function widgetCsv(widget: AnalyticsWidget): string {
  const metadata = [["widget", widget.title], ["metrica", widget.metricLabel], ["agregacao", widget.aggregation], ["periodo", widget.period.preset], ["estado", widget.state]];
  const body = widget.rows?.length ? [widget.columns ?? Object.keys(widget.rows[0] ?? {}), ...widget.rows.map((row) => (widget.columns ?? Object.keys(row)).map((column) => row[column]))] : [["dimensao", "valor"], ...widget.points.map((point) => [point.label, point.value])];
  return `\uFEFF${[...metadata, [], ...body].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}
