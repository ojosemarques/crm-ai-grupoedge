"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { marketingDateRanges, marketingPeriodShortcuts } from "@/modules/marketing/domain/marketing-date-range";
import styles from "./marketing-period-filter.module.css";

export function MarketingPeriodFilter({ basePath, from, to, today }: Readonly<{ basePath: string; from: string; to: string; today: string }>) {
  const searchParams = useSearchParams();
  const ranges = marketingDateRanges(today);
  const matched = marketingPeriodShortcuts.find(([preset]) => ranges[preset].from === from && ranges[preset].to === to)?.[0];
  const requested = searchParams.get("periodPreset");
  const requestedMatch = marketingPeriodShortcuts.find(([preset]) => preset === requested && ranges[preset].from === from && ranges[preset].to === to)?.[0];
  const selected = requested === "CUSTOM" ? "CUSTOM" : requestedMatch ?? matched ?? "CUSTOM";
  const [customOpen, setCustomOpen] = useState(selected === "CUSTOM");
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const panelId = useId();
  const labelDate = (date: string) => date.split("-").reverse().join("/");
  const preserved = [...searchParams.entries()].filter(([key]) => !["periodStart", "periodEnd", "periodPreset", "page", "activityPage"].includes(key));

  return <section className={styles.filter} aria-label="Período do marketing">
    <div className={styles.topRow}>
      <nav className={styles.presets} aria-label="Atalhos de período">
        {marketingPeriodShortcuts.map(([preset, label]) => {
          const params = new URLSearchParams(preserved);
          params.set("periodStart", ranges[preset].from); params.set("periodEnd", ranges[preset].to); params.set("periodPreset", preset);
          return <Link key={preset} aria-current={selected === preset ? "page" : undefined} className={styles.preset} href={`${basePath}?${params}`} scroll={false}>{label}</Link>;
        })}
        <button aria-controls={panelId} aria-expanded={customOpen} aria-pressed={selected === "CUSTOM"} className={styles.preset} data-active={selected === "CUSTOM"} onClick={() => setCustomOpen(!customOpen)} type="button">Personalizado</button>
      </nav>
      <span className={styles.range}>{labelDate(from)} — {labelDate(to)}</span>
    </div>
    {customOpen ? <form action={basePath} className={styles.custom} id={panelId} method="get">
      {preserved.map(([name, value], index) => <input key={`${name}-${index}`} name={name} type="hidden" value={value} />)}
      <input name="periodPreset" type="hidden" value="CUSTOM" />
      <label>Data inicial<input max={customTo && customTo < today ? customTo : today} name="periodStart" onChange={(event) => setCustomFrom(event.target.value)} required type="date" value={customFrom} /></label>
      <label>Data final<input max={today} min={customFrom} name="periodEnd" onChange={(event) => setCustomTo(event.target.value)} required type="date" value={customTo} /></label>
      <button type="submit">Aplicar período</button>
      <small>O período inclui as duas datas, no horário de São Paulo.</small>
    </form> : null}
  </section>;
}
