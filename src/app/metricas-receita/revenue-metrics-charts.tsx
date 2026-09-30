"use client";

import { useId, useState } from "react";
import type { RevenueTimeSeries } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueMetricRegistryById } from "@/modules/metrics/domain/revenue-metric-registry";
import { revenueChartData, revenueChartDomain, revenueLineSegments } from "./revenue-chart-data";
import styles from "./revenue-metrics.module.css";

const palette = ["#ff6b2c", "#469de4"];
function labelForBucket(bucket: string) {
  const [year, month, day] = bucket.split("-");
  return year && month && day ? `${day}/${month}` : year && month ? `${month}/${year.slice(2)}` : bucket;
}
function numberLabel(value: number, money: boolean, compact = false) {
  return new Intl.NumberFormat("pt-BR", { ...(money ? { style: "currency", currency: "BRL" } : {}), ...(compact ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 } : { minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: 2 }) }).format(value);
}

export function RevenueSeriesChart({ metricId, compareMetricId, series, variant = "area" }: Readonly<{ metricId: string; compareMetricId?: string; series: readonly RevenueTimeSeries[]; variant?: "area" | "bar" }>) {
  const uniqueId = useId().replaceAll(":", "");
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const datasets = [metricId, ...(compareMetricId ? [compareMetricId] : [])].map((id) => ({ id, label: revenueMetricRegistryById.get(id)?.name ?? id, ...revenueChartData(id, series) }));
  const buckets = [...new Set(datasets.flatMap((dataset) => dataset.points.map((point) => point.bucket)))].sort();
  const rows = datasets.map((dataset) => ({ ...dataset, points: buckets.map((bucket) => dataset.points.find((point) => point.bucket === bucket) ?? { bucket, value: null, state: "UNAVAILABLE" }) }));
  const values = rows.flatMap((dataset) => dataset.points.map((point) => point.value));
  if (!values.some((value) => value !== null)) return <div className={styles.chartEmpty}><span>Sem série disponível</span><p>Os valores ausentes ou fora da precisão do gráfico permanecem na tabela de dados.</p></div>;
  const { minimum, maximum } = revenueChartDomain(values);
  const left = 62, right = 610, top = 18, bottom = 215;
  const step = (right - left) / Math.max(buckets.length, 1);
  const x = (index: number) => left + step * (index + .5);
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
  const selected = activeBucket ?? buckets.at(-1);
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 7));
  return <div className={styles.chart}>
    <div className={styles.chartLegend}>{rows.map((dataset, index) => <span data-color={index === 0 ? "orange" : "blue"} key={dataset.id}>{dataset.label}</span>)}</div>
    <svg aria-label={`Evolução de ${rows.map((row) => row.label).join(" e ")}. Valores disponíveis abaixo e na tabela.`} className={styles.seriesSvg} viewBox="0 0 640 248">
      <defs>{rows.map((dataset, index) => <linearGradient id={`${uniqueId}-${index}`} key={dataset.id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={palette[index]} stopOpacity=".28" /><stop offset="100%" stopColor={palette[index]} stopOpacity=".02" /></linearGradient>)}</defs>
      {[0, 1, 2, 3, 4].map((tick) => { const value = minimum + (maximum - minimum) * tick / 4; return <g key={tick}><line stroke="#e9eae7" strokeDasharray="3 5" x1={left} x2={right} y1={y(value)} y2={y(value)} /><text fill="#858880" fontSize="10" textAnchor="end" x={left - 10} y={y(value) + 3}>{numberLabel(value, rows[0]!.money, true)}</text></g>; })}
      <line stroke="#d9dcd5" x1={left} x2={right} y1={y(0)} y2={y(0)} />
      {buckets.map((bucket, index) => index % tickEvery === 0 || index === buckets.length - 1 ? <text fill="#858880" fontSize="10" key={bucket} textAnchor="middle" x={x(index)} y="238">{labelForBucket(bucket)}</text> : null)}
      {rows.map((dataset, datasetIndex) => <g key={dataset.id}>
        {variant === "area" ? revenueLineSegments(dataset.points).map((segment, index) => { const path = segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${x(point.index)},${y(point.value)}`).join(" "); return <g key={index}><path d={`${path} L${x(segment.at(-1)!.index)},${y(0)} L${x(segment[0]!.index)},${y(0)} Z`} fill={`url(#${uniqueId}-${datasetIndex})`} /><path d={path} fill="none" stroke={palette[datasetIndex]} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /></g>; }) : null}
        {dataset.points.map((point, index) => {
          if (point.value === null) return null;
          const width = Math.min(24, step * .7 / rows.length);
          const barX = x(index) + (datasetIndex - (rows.length - 1) / 2) * (width + 2) - width / 2;
          const label = `${dataset.label}, ${point.bucket}: ${numberLabel(point.value, dataset.money)}`;
          return <g aria-label={label} className={styles.chartPoint} key={point.bucket} onBlur={() => setActiveBucket(null)} onFocus={() => setActiveBucket(point.bucket)} onMouseEnter={() => setActiveBucket(point.bucket)} onMouseLeave={() => setActiveBucket(null)} role="img" tabIndex={0}><title>{label}</title>{variant === "bar" ? <rect fill={palette[datasetIndex]} height={Math.max(2, Math.abs(y(point.value) - y(0)))} rx="4" width={width} x={barX} y={Math.min(y(point.value), y(0))} /> : <><circle cx={x(index)} cy={y(point.value)} fill={palette[datasetIndex]} r={buckets.length <= 12 || selected === point.bucket ? 3.5 : 1.5} stroke="white" strokeWidth="1.5" /><circle cx={x(index)} cy={y(point.value)} fill="transparent" r="10" /></>}</g>;
        })}
      </g>)}
    </svg>
    <div aria-live="polite" className={styles.chartReadout}><span>{selected ? labelForBucket(selected) : "Período"}</span>{rows.map((row) => { const point = row.points.find((item) => item.bucket === selected); return <span key={row.id}>{row.label}<strong>{point?.value !== null && point?.value !== undefined ? numberLabel(point.value, row.money) : "Indisponível"}</strong></span>; })}</div>
  </div>;
}
