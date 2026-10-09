"use client";

import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import styles from "@/app/dashboard/dashboard.module.css";
import type { DashboardTimeSeries } from "@/modules/metrics/domain/dashboard-contracts";

type TrendChartProps = Readonly<{
  title: string;
  description: string;
  series: readonly DashboardTimeSeries[];
  previousSeries: readonly DashboardTimeSeries[];
  allowedSeries: readonly string[];
  defaultSeries: string;
  currentPeriodLabel: string;
  previousPeriodLabel: string;
}>;

const flowSeries = [
  { id: "leads", label: "Recebidos", color: "#f98b52" },
  { id: "calls", label: "Ligações", color: "#f2ad55" },
  { id: "connected", label: "Conectados", color: "#4db7e4" },
  { id: "qualified", label: "Qualificados", color: "#6c8cff" },
  { id: "scheduled", label: "Agendados", color: "#b475fa" },
  { id: "sales", label: "Vendas", color: "#43c7a0" },
] as const;

export function KpiSparkline({ series, label }: Readonly<{ series: DashboardTimeSeries | undefined; label: string }>) {
  const points = series?.points.map((point) => numericValue(series, point.value)) ?? [];
  if (!points.some((value) => value !== null && value !== 0)) return <span className={styles.sparklineEmpty}>Sem eventos no período</span>;
  const values = points.map((value, index) => ({ index, value }));
  return <div aria-label={`Tendência de ${label}`} className={styles.sparkline} role="img"><ResponsiveContainer height="100%" width="100%"><AreaChart data={values} margin={{ top: 3, right: 2, bottom: 1, left: 2 }}><Area dataKey="value" dot={false} fill="var(--chart-accent)" fillOpacity={0.12} isAnimationActive={false} stroke="var(--chart-accent)" strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer></div>;
}

export function CommercialFlowChart({ series }: Readonly<{ series: readonly DashboardTimeSeries[] }>) {
  const present = flowSeries.flatMap((item) => {
    const data = series.find((source) => source.id === item.id);
    return data ? [{ ...item, data, byBucket: new Map(data.points.map((point) => [point.bucket, point.value])) }] : [];
  });
  const buckets = present[0]?.data?.points ?? [];
  const data = buckets.map((point) => Object.fromEntries([
    ["bucket", point.bucket],
    ...present.map((item) => [item.id, numericValue(item.data, item.byBucket.get(point.bucket) ?? null)]),
  ]));
  if (!data.some((point) => present.some((item) => Number(point[item.id] ?? 0) > 0))) return <div className={styles.chartEmpty}><strong>Sem movimento na jornada</strong><span>O gráfico será preenchido quando houver eventos reais neste período.</span></div>;
  return <div aria-label="Volume de marcos comerciais por período" className={styles.flowChart} role="img"><ResponsiveContainer height="100%" width="100%"><BarChart accessibilityLayer barGap={2} data={data} margin={{ top: 12, right: 8, bottom: 2, left: 0 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis axisLine={false} dataKey="bucket" minTickGap={20} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={compactBucket} tickLine={false} /><YAxis axisLine={false} allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} width={36} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", color: "var(--foreground)" }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />{present.map((item) => <Bar dataKey={item.id} fill={item.color} isAnimationActive={false} key={item.id} maxBarSize={18} name={item.label} radius={[4, 4, 0, 0]} />)}</BarChart></ResponsiveContainer></div>;
}

function numericValue(series: DashboardTimeSeries, value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return series.kind === "MONEY" ? parsed / 100 : parsed;
}

function compactBucket(value: string) {
  if (value.includes("T")) return `${value.slice(11, 13)}h`;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}` : value;
}

function formatNumber(value: number, kind: DashboardTimeSeries["kind"]) {
  if (kind === "MONEY") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (kind === "RATE") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (kind === "DURATION") return `${value.toLocaleString("pt-BR")} s`;
  return value.toLocaleString("pt-BR");
}

function axisValue(value: number, kind: DashboardTimeSeries["kind"]) {
  if (kind === "MONEY") {
    return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return new Intl.NumberFormat("pt-BR", { notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function exactValue(value: number | string | null, kind: DashboardTimeSeries["kind"]) {
  if (value === null) return "Sem amostra";
  if (kind !== "MONEY") return formatNumber(Number(value), kind);
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "−" : ""}R$ ${new Intl.NumberFormat("pt-BR").format(absolute / 100n)},${(absolute % 100n).toString().padStart(2, "0")}`;
}

function TrendChart({
  title,
  description,
  series,
  previousSeries,
  allowedSeries,
  defaultSeries,
  currentPeriodLabel,
  previousPeriodLabel,
}: TrendChartProps) {
  const gradientId = useId();
  const descriptionId = useId();
  const available = allowedSeries.flatMap((id) => {
    const current = series.find((item) => item.id === id);
    return current ? [current] : [];
  });
  const [selectedId, setSelectedId] = useState(
    available.some((item) => item.id === defaultSeries) ? defaultSeries : (available[0]?.id ?? ""),
  );
  const selected = available.find((item) => item.id === selectedId) ?? available[0];
  const previous = previousSeries.find((item) => item.id === selected?.id);
  const data = (() => {
    if (!selected) return [];
    const length = Math.max(selected.points.length, previous?.points.length ?? 0);
    return Array.from({ length }, (_, index) => {
      const currentPoint = selected.points[index];
      const previousPoint = previous?.points[index];
      return {
        index,
        label: currentPoint?.bucket ?? previousPoint?.bucket ?? `Ponto ${index + 1}`,
        currentBucket: currentPoint?.bucket ?? "—",
        previousBucket: previousPoint?.bucket ?? "—",
        currentRaw: currentPoint?.value ?? null,
        previousRaw: previousPoint?.value ?? null,
        current: numericValue(selected, currentPoint?.value ?? null),
        previous: numericValue(selected, previousPoint?.value ?? null),
      };
    });
  })();

  if (!selected) {
    return <div className={styles.chartEmpty}>Nenhuma série está disponível para este recorte.</div>;
  }
  const hasMeasuredValue = data.some((point) => (point.current ?? 0) !== 0 || (point.previous ?? 0) !== 0);
  const chartDescription = `${description}. ${selected.label}, ${currentPeriodLabel}, comparado com ${previousPeriodLabel}. ${selected.formula}.`;

  return (
    <div className={styles.chartContent}>
      <div aria-label={`Séries de ${title}`} className={styles.chartSelector} role="group">
        {available.map((item) => (
          <button
            aria-pressed={item.id === selected.id}
            className={styles.chartSelectorButton}
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className={styles.srOnly} id={descriptionId}>{chartDescription}</p>
      <div className={styles.chartLegend}><span title={currentPeriodLabel}><i />Período atual</span><span title={previousPeriodLabel}><i />Período anterior</span></div>
      {!hasMeasuredValue ? (
        <div className={styles.chartEmpty} role="status">
          <strong>Sem eventos nesta série</strong>
          <span>Selecione outro indicador ou consulte os valores registrados na tabela.</span>
        </div>
      ) : (
        <div
          aria-describedby={descriptionId}
          aria-label={`Gráfico de ${selected.label}`}
          className={styles.chartCanvas}
          role="img"
        >
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart accessibilityLayer data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
              <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-accent)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-accent)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={compactBucket}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(value: number) => axisValue(value, selected.kind)}
                tickLine={false}
                width={54}
              />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", boxShadow: "var(--shadow-card)" }}
                formatter={(value, name) => [formatNumber(Number(value), selected.kind), String(name)]}
                labelFormatter={(label) => `Período: ${String(label)}`}
              />
              <Area
                activeDot={{ r: 5 }}
                dataKey="current"
                dot={data.length <= 14}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                name={`Atual · ${currentPeriodLabel}`}
                stroke="var(--chart-accent)"
                strokeWidth={2.5}
                type="monotone"
              />
              <Line
                dataKey="previous"
                dot={false}
                isAnimationActive={false}
                name={`Anterior · ${previousPeriodLabel}`}
                stroke="var(--brand-steel)"
                strokeDasharray="6 5"
                strokeWidth={2}
                type="monotone"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <details className={styles.chartTableDetails}>
        <summary>Ver dados em tabela</summary>
        <div className={styles.chartTableScroll}>
          <table className={styles.chartTable}>
            <thead><tr><th>Período atual</th><th>Valor atual</th><th>Período anterior</th><th>Valor anterior</th></tr></thead>
            <tbody>
              {data.map((point) => (
                <tr key={`${point.index}:${point.currentBucket}`}>
                  <td>{point.currentBucket}</td>
                  <td>{exactValue(point.currentRaw, selected.kind)}</td>
                  <td>{point.previousBucket}</td>
                  <td>{exactValue(point.previousRaw, selected.kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function CommercialEvolutionChart(props: Omit<TrendChartProps, "allowedSeries" | "defaultSeries">) {
  return (
    <TrendChart
      {...props}
      allowedSeries={["leads", "calls", "connected", "qualified", "scheduled", "sales"]}
      defaultSeries="leads"
    />
  );
}

export function RevenueSalesChart(props: Omit<TrendChartProps, "allowedSeries" | "defaultSeries">) {
  return (
    <TrendChart
      {...props}
      allowedSeries={["revenue", "sales"]}
      defaultSeries="revenue"
    />
  );
}
