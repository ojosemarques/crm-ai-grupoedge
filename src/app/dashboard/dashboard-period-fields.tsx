"use client";

import { useState } from "react";

import styles from "./dashboard.module.css";
import type { DashboardPeriodPreset } from "@/modules/metrics/domain/dashboard-contracts";

type PeriodSelection = Readonly<{ preset: DashboardPeriodPreset; fromDate: string; toDate: string }>;

export function selectDashboardDate(current: PeriodSelection, field: "fromDate" | "toDate", value: string): PeriodSelection {
  return {
    ...current,
    preset: "CUSTOM",
    [field]: value,
    ...(current.preset === "CUSTOM" ? {} : { [field === "fromDate" ? "toDate" : "fromDate"]: value }),
  };
}

export function DashboardPeriodFields({ preset, fromDate, toDate }: Readonly<{
  preset: DashboardPeriodPreset;
  fromDate: string;
  toDate: string;
}>) {
  const [selection, setSelection] = useState({ preset, fromDate, toDate });

  function selectDate(field: "fromDate" | "toDate", value: string) {
    setSelection((current) => selectDashboardDate(current, field, value));
  }

  function syncDate(field: "fromDate" | "toDate", value: string) {
    if (value && value !== selection[field]) selectDate(field, value);
  }

  return <>
    <label className={styles.field}>Período<select name="preset" onChange={(event) => setSelection((current) => ({ ...current, preset: event.target.value as DashboardPeriodPreset }))} value={selection.preset}><option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana atual</option><option value="MONTH">Mês atual</option><option value="CUSTOM">Personalizado</option></select></label>
    <label className={styles.field}>Data inicial<input name="fromDate" onBlur={(event) => syncDate("fromDate", event.currentTarget.value)} onChange={(event) => selectDate("fromDate", event.target.value)} onInput={(event) => syncDate("fromDate", event.currentTarget.value)} required type="date" value={selection.fromDate} /></label>
    <label className={styles.field}>Data final<input name="toDate" onBlur={(event) => syncDate("toDate", event.currentTarget.value)} onChange={(event) => selectDate("toDate", event.target.value)} onInput={(event) => syncDate("toDate", event.currentTarget.value)} required type="date" value={selection.toDate} /></label>
  </>;
}
