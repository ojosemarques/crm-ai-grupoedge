import Link from "next/link";
import type { DashboardFunnelNode, DashboardSegment } from "@/modules/metrics/domain/dashboard-contracts";
import styles from "./dashboard.module.css";

const palette = ["#ff873e", "#46b8e9", "#8760e8", "#f27eae", "#66bd96", "#e5bd58"];
type LinkedSegment = DashboardSegment & { href: string };

export function StageDistribution({ segments, totalHref }: Readonly<{ segments: readonly LinkedSegment[]; totalHref?: string | undefined }>) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return <section className={`${styles.panel} ${styles.distributionPanel}`}>
    <header className={styles.panelHeader}><div><h2>Distribuição por etapa</h2><p>Leads em aberto com etapa registrada</p></div><span className={styles.headerIcon} aria-hidden="true">◔</span></header>
    <div className={styles.donutWrap}>
      <svg aria-label={`${total.toLocaleString("pt-BR")} leads distribuídos por etapa`} className={styles.donutSvg} role="img" viewBox="0 0 240 240">
        <circle cx="120" cy="120" fill="none" r="88" stroke="var(--border)" strokeWidth="30" />
        {total > 0 ? segments.map((segment, index) => {
          const percent = segment.value / total * 100;
          const start = offset;
          offset += percent;
          return <circle cx="120" cy="120" fill="none" key={segment.id} pathLength="100" r="88" stroke={palette[index % palette.length]} strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start} strokeWidth="30" transform="rotate(-90 120 120)"><title>{`${segment.label}: ${segment.value.toLocaleString("pt-BR")} leads (${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}</title></circle>;
        }) : null}
        {totalHref ? <a aria-label="Abrir registros do total em etapas" href={totalHref}><text className={styles.donutCaption} textAnchor="middle" x="120" y="111">Nas etapas</text><text className={styles.donutValue} textAnchor="middle" x="120" y="145">{total.toLocaleString("pt-BR")}</text></a> : <><text className={styles.donutCaption} textAnchor="middle" x="120" y="111">Nas etapas</text><text className={styles.donutValue} textAnchor="middle" x="120" y="145">{total.toLocaleString("pt-BR")}</text></>}
      </svg>
    </div>
    {total > 0 ? <ul className={styles.donutLegend}>{segments.map((segment, index) => <li key={segment.id}><Link href={segment.href}><svg aria-hidden="true" height="8" width="8"><circle cx="4" cy="4" fill={palette[index % palette.length]} r="4" /></svg><span>{segment.label}</span><strong>{segment.value.toLocaleString("pt-BR")}</strong><small>{(segment.value / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</small></Link></li>)}</ul> : <p className={styles.donutEmpty}>Não há leads em aberto neste recorte.</p>}
  </section>;
}

export function ConnectedFunnel({ stages }: Readonly<{ stages: readonly (DashboardFunnelNode & { href: string })[] }>) {
  if (!stages.length) return <div className={styles.segmentEmpty}>Nenhuma etapa disponível neste período.</div>;
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  const width = stages.length * 155;
  const warmPalette = ["#ff6b2c", "#ff8343", "#ff9b56", "#fbb869", "#ebca78", "#bfcf96", "#a9c8ad"];
  return <>
    <div className={styles.connectedFunnelScroll}>
      <svg aria-label="Funil comercial: volume e conversão por etapa" className={styles.connectedFunnel} role="group" viewBox={`0 0 ${width} 265`}>
        {stages.map((stage, index) => {
          const next = stages[index + 1];
          const x = index * 155;
          const height = stage.value / max * 135;
          const nextHeight = (next?.value ?? stage.value) / max * 135;
          const top = 224 - height;
          const nextTop = 224 - nextHeight;
          const difference = index > 0 ? stage.value - (stages[index - 1]?.value ?? 0) : null;
          return <a aria-label={`${stage.label}: ${stage.value.toLocaleString("pt-BR")}. Abrir registros`} href={stage.href} key={stage.id}>
            <rect fill="transparent" height="265" width="155" x={x} y="0" />
            <text className={styles.funnelLabel} x={x + 12} y="22">{stage.id === "received" ? "Entrada" : stage.label}</text>
            <text className={styles.funnelNumber} x={x + 12} y="57">{stage.value.toLocaleString("pt-BR")}</text>
            <text className={styles.funnelDetail} x={x + 12} y="77">{stage.percentage === null ? "Base da jornada" : `${stage.percentage.toLocaleString("pt-BR")}% da anterior`}</text>
            <path d={`M ${x} ${top} C ${x + 78} ${top}, ${x + 78} ${nextTop}, ${x + 155} ${nextTop} L ${x + 155} 224 L ${x} 224 Z`} fill={warmPalette[index % warmPalette.length]} fillOpacity=".86"><title>{`${stage.label}: ${stage.value}. Denominador: ${stage.denominator ?? "não aplicável"}.`}</title></path>
            <line stroke="var(--surface)" strokeOpacity=".85" strokeWidth="2" x1={x} x2={x} y1="88" y2="224" />
            <text className={styles.funnelDetail} x={x + 12} y="248">{difference === null ? "Leads recebidos" : `${difference > 0 ? "+" : ""}${difference.toLocaleString("pt-BR")} vs. etapa anterior`}</text>
          </a>;
        })}
      </svg>
    </div>
    <details className={styles.chartTableDetails}><summary>Conversão e denominadores</summary><div className={styles.chartTableScroll}><table className={styles.chartTable}><thead><tr><th>Etapa</th><th>Volume</th><th>Base anterior</th><th>Conversão</th></tr></thead><tbody>{stages.map((stage) => <tr key={stage.id}><td><Link href={stage.href}>{stage.label}</Link></td><td><Link href={stage.href}>{stage.value.toLocaleString("pt-BR")}</Link></td><td><Link href={stage.href}>{stage.denominator?.toLocaleString("pt-BR") ?? "—"}</Link></td><td><Link href={stage.href}>{stage.percentage === null ? "—" : `${stage.percentage.toLocaleString("pt-BR")}%`}</Link></td></tr>)}</tbody></table></div></details>
  </>;
}
