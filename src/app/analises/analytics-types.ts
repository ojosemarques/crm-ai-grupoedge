export type ChartType = "LINE" | "AREA" | "BAR" | "PIE" | "DONUT" | "FUNNEL" | "TABLE" | "NUMBER" | "KPI";
export type DataState = "DATA" | "EMPTY" | "DELAYED" | "ERROR";
export type CatalogOption = Readonly<{ key: string; label: string; description?: string; unit?: "COUNT" | "PERCENT" | "CURRENCY" | "DURATION" | "NUMBER"; dateBases?: readonly string[] }>;
export type WidgetPoint = Readonly<{ key: string; label: string; value: number; href?: string | null }>;
export type WidgetFilter = Readonly<{ field: string; operator: "EQ" | "IN" | "NOT_IN" | "CONTAINS"; value: string }>;
export type AnalyticsWidget = Readonly<{
  id: string; title: string; description?: string | null; type: ChartType; metricKey: string; metricLabel: string; revision?: number;
  unit?: CatalogOption["unit"]; aggregation: string; dimensionKey?: string | null; dateBasis: string;
  period: Readonly<{ preset: string; from?: string | null; to?: string | null }>;
  filters: readonly WidgetFilter[]; state: DataState; stateMessage?: string | null; freshnessAt?: string | null;
  drilldownHref?: string | null; value?: number | null; comparisonValue?: number | null; points: readonly WidgetPoint[];
  columns?: readonly string[]; rows?: readonly Readonly<Record<string, string | number | null>>[];
}>;
export type SavedDashboard = Readonly<{ id: string; name: string; description?: string | null; revision: number; widgets: readonly AnalyticsWidget[] }>;
export type AnalyticsShell = Readonly<{
  dashboards: readonly SavedDashboard[]; activeDashboardId: string | null; generatedAt: string; timeZone: string;
  catalog: Readonly<{ metrics: readonly CatalogOption[]; dimensions: readonly CatalogOption[]; dateBases: readonly CatalogOption[]; filterFields: readonly CatalogOption[]; aggregations: readonly CatalogOption[] }>;
  permissions?: Readonly<{ canManage?: boolean; canExport?: boolean }>;
}>;

export type WidgetDraft = Readonly<{ id?: string; title: string; description: string; type: ChartType; metricKey: string; aggregation: string; dimensionKey: string; dateBasis: string; preset: string; from: string; to: string; filters: readonly WidgetFilter[] }>;
