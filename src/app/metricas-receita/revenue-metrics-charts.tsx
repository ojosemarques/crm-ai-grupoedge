"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RevenueTimeSeries } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueChartData } from "./revenue-chart-data";
import styles from "./revenue-metrics.module.css";

function labelForBucket(bucket: string) {
  const [year, month, day] = bucket.split("-");
  return year && month && day ? `${day}/${month}` : year && month ? `${month}/${year.slice(2)}` : bucket;
}

function compactNumber(value: number, money: boolean) {
  const label = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return money ? `R$ ${label}` : label;
}

export function RevenueSeriesChart({ metricId, series, variant = "area" }: Readonly<{ metricId: string; series: readonly RevenueTimeSeries[]; variant?: "area" | "bar" }>) {
  const { money, points: data } = revenueChartData(metricId, series);
  if (!data.some((point) => point.value !== null && point.value !== 0)) return <div className={styles.chartEmpty}>Ainda não há movimento real nesta série.</div>;
  const axis = { fill: "var(--muted-foreground)", fontSize: 11 };
  const common = <><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} /><XAxis axisLine={false} dataKey="bucket" minTickGap={20} tick={axis} tickFormatter={labelForBucket} tickLine={false} /><YAxis axisLine={false} tick={axis} tickFormatter={(value: number) => compactNumber(value, money)} tickLine={false} width={66} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)" }} formatter={(value) => [money ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)) : Number(value).toLocaleString("pt-BR"), "Valor"]} labelFormatter={(value) => `Período ${String(value)}`} /></>;
  return <div aria-label={`Gráfico da série ${metricId}`} className={styles.chart} role="img"><ResponsiveContainer height="100%" width="100%">{variant === "bar" ? <BarChart accessibilityLayer data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>{common}<Bar dataKey="value" fill="#fb8754" isAnimationActive={false} maxBarSize={30} radius={[6, 6, 0, 0]} /></BarChart> : <AreaChart accessibilityLayer data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}><defs><linearGradient id={`revenue-${metricId.replaceAll(".", "-")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#fa8750" stopOpacity={0.34} /><stop offset="100%" stopColor="#fa8750" stopOpacity={0} /></linearGradient></defs>{common}<Area connectNulls={false} dataKey="value" dot={data.length <= 12} fill={`url(#revenue-${metricId.replaceAll(".", "-")})`} isAnimationActive={false} stroke="#fa8750" strokeWidth={2.5} type="monotone" /></AreaChart>}</ResponsiveContainer></div>;
}
