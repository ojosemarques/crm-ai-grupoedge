"use client";

import { useId, useState } from "react";
import styles from "./analytics-chart.module.css";

type Series = Readonly<{ key: string; label: string; color: string }>;
type Point = Readonly<{ label: string; values: Readonly<Record<string, number>> }>;

/** SVG attributes keep chart geometry compatible with the application's CSP. */
export function AnalyticsChart({ points, series, formatValue, label }: Readonly<{ points: readonly Point[]; series: readonly Series[]; formatValue: (value: number) => string; label: string }>) {
  const id = useId().replaceAll(":", "");
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return null;
  const maximum = Math.max(1, ...points.flatMap((point) => series.map((item) => point.values[item.key] ?? 0)));
  const x = (index: number) => 68 + index * 652 / Math.max(1, points.length - 1);
  const y = (value: number) => 226 - value / maximum * 190;
  const selectedIndex = Math.min(active ?? points.length - 1, points.length - 1);
  const selected = points[selectedIndex];
  return <div className={styles.chart}>
    <div className={styles.legend}>{series.map((item, index) => <span key={item.key}><svg width="9" height="9" aria-hidden="true"><circle cx="4.5" cy="4.5" r="4" fill={item.color} /></svg>{item.label}<span className="sr-only">Série {index + 1}</span></span>)}</div>
    <svg className={styles.plot} viewBox="0 0 756 274" role="group" aria-label={label}>
      <defs>{series.map((item, index) => <linearGradient id={`${id}-${index}`} key={item.key} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".22" /><stop offset="100%" stopColor={item.color} stopOpacity=".01" /></linearGradient>)}</defs>
      {[0, 1, 2, 3, 4].map((step) => <g className={styles.grid} key={step}><line x1="68" x2="720" y1={y(maximum * step / 4)} y2={y(maximum * step / 4)} /><text x="57" y={y(maximum * step / 4) + 4} textAnchor="end">{new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(maximum * step / 4)}</text></g>)}
      {series.map((item, index) => { const path = points.map((point, position) => `${position ? "L" : "M"} ${x(position)} ${y(point.values[item.key] ?? 0)}`).join(" "); return <g key={item.key}><path d={`${path} L ${x(points.length - 1)} 226 L 68 226 Z`} fill={`url(#${id}-${index})`} /><path d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /></g>; })}
      {selected ? <line className={styles.cursor} x1={x(selectedIndex)} x2={x(selectedIndex)} y1="30" y2="226" /> : null}
      {points.map((point, index) => <g key={`${point.label}-${index}`}>
        {(index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0) ? <text className={styles.axisLabel} x={x(index)} y="256" textAnchor="middle">{point.label.split(",")[0]}</text> : null}
        {series.map((item) => <circle key={item.key} cx={x(index)} cy={y(point.values[item.key] ?? 0)} r={selectedIndex === index ? 4 : 2} fill="white" stroke={item.color} strokeWidth="2" />)}
        <rect className={styles.hitArea} x={x(index) - Math.min(18, 326 / Math.max(1, points.length - 1))} y="26" width={Math.min(36, 652 / Math.max(1, points.length - 1))} height="202" fill="transparent" tabIndex={0} role="button" aria-label={`${point.label}: ${series.map((item) => `${item.label} ${formatValue(point.values[item.key] ?? 0)}`).join(", ")}`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const direction = event.key === "ArrowRight" ? 1 : -1; setActive((current) => Math.max(0, Math.min(points.length - 1, (current ?? index) + direction))); } }}><title>{point.label}</title></rect>
      </g>)}
    </svg>
    {selected ? <div className={styles.readout} aria-live="polite"><span>{selected.label}</span>{series.map((item) => <div key={item.key}><small>{item.label}</small><strong>{formatValue(selected.values[item.key] ?? 0)}</strong></div>)}</div> : null}
  </div>;
}
