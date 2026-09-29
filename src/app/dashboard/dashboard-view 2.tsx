import Link from "next/link";

import styles from "@/app/dashboard/dashboard.module.css";
import { Icon, type IconName } from "@/components/ui/icon";
import type {
  DashboardKpi,
  DashboardQuery,
  DashboardScreen,
  DashboardSegment,
} from "@/modules/metrics/domain/dashboard-contracts";

function paramsFor(query: DashboardQuery, extras: Record<string, string> = {}) {
  const params = new URLSearchParams({
    preset: query.preset,
    fromDate: query.fromDate,
    toDate: query.toDate,
    ...extras,
  });
  const mappings = [
    ["sdr", query.filters.sdrMemberIds], ["closer", query.filters.closerMemberIds],
    ["team", query.filters.teamIds], ["source", query.filters.sourceIds],
    ["campaign", query.filters.campaignIds], ["creative", query.filters.creativeIds],
    ["priority", query.filters.priorityCodes], ["product", query.filters.productIds],
  ] as const;
  for (const [name, values] of mappings) for (const value of values) params.append(name, value);
  return params;
}

export function dashboardHref(query: DashboardQuery, view: string) {
  return `/dashboard/registros?${paramsFor(query, { view }).toString()}`;
}

function formatMoney(cents: string | null) {
  if (cents === null) return "—";
  const value = BigInt(cents);
  const whole = value / 100n;
  const fraction = (value < 0n ? -value : value) % 100n;
  return `R$ ${new Intl.NumberFormat("pt-BR").format(whole)},${fraction.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Sem medição";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours < 24) return `${hours}h ${minutes}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function metricValue(metric: DashboardKpi) {
  if (metric.kind === "MONEY") return formatMoney(typeof metric.value === "string" ? metric.value : null);
  if (metric.kind === "DURATION") return formatDuration(typeof metric.value === "number" ? metric.value : null);
  if (metric.kind === "RATE") return metric.value === null ? "—" : `${metric.value}%`;
  return new Intl.NumberFormat("pt-BR").format(Number(metric.value ?? 0));
}

function metricRatio(metric: DashboardKpi) {
  if (metric.denominator === null) return `Numerador: ${metric.numerator}`;
  return `${metric.numerator} de ${metric.denominator}`;
}

const metricIcons: Readonly<Record<string, IconName>> = {
  revenue: "receita",
  sales: "tendencia",
  opportunities: "vendas",
  leads: "leads",
  proposals: "pipeline",
  scheduled: "agenda",
  held: "agenda",
  qualified: "auditoria",
  connected: "leads",
  mrr: "receita",
  tcv: "receita",
  ticket: "receita",
  sla: "relogio",
  backlog: "pipeline",
  stalled: "alerta",
  "no-next-action": "alerta",
  "no-show": "alerta",
};

function MetricCard({
  featured = false,
  metric,
  query,
}: Readonly<{
  featured?: boolean;
  metric: DashboardKpi;
  query: DashboardQuery;
}>) {
  return (
    <Link
      className={`${styles.metricCard} ${featured ? styles.metricFeatured : ""}`}
      href={dashboardHref(query, metric.drilldownId)}
    >
      <span className={styles.metricHeader}>
        <span className={styles.metricLabel}>{metric.label}</span>
        <span className={styles.metricIcon}><Icon name={metricIcons[metric.id] ?? "tendencia"} size={18} /></span>
      </span>
      <strong className={styles.metricValue}>{metricValue(metric)}</strong>
      <span className={styles.metricDetail}>{metric.detail}</span>
      <span className={styles.metricFooter}>
        <span className={styles.metricRatio}>{metricRatio(metric)}</span>
        <span className={styles.metricArrow}><Icon name="seta-direita" size={14} /></span>
      </span>
    </Link>
  );
}

function SmallKpi({ metric, query }: Readonly<{ metric: DashboardKpi; query: DashboardQuery }>) {
  return (
    <Link className={styles.smallKpi} href={dashboardHref(query, metric.drilldownId)}>
      <span>{metric.label}</span>
      <strong>{metricValue(metric)}</strong>
      <span>{metricRatio(metric)}</span>
    </Link>
  );
}

function SegmentList({
  title,
  description,
  segments,
  query,
  secondaryKind = "COUNT",
  limit,
}: Readonly<{
  title: string;
  description: string;
  segments: readonly DashboardSegment[];
  query: DashboardQuery;
  secondaryKind?: "COUNT" | "DURATION" | "MONEY";
  limit?: number;
}>) {
  const visibleSegments = limit ? segments.slice(0, limit) : segments;
  const max = Math.max(1, ...visibleSegments.map((segment) => segment.value));
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><h2>{title}</h2><p>{description}</p></div>
      </header>
      {visibleSegments.length === 0 ? (
        <div className={styles.segmentEmpty}>Sem dados para este recorte. Nenhum segmento foi inventado.</div>
      ) : (
        <ol className={styles.segmentList}>
          {visibleSegments.map((segment) => {
            const secondary = segment.secondaryValue === null
              ? null
              : secondaryKind === "DURATION"
                ? formatDuration(Number(segment.secondaryValue))
                : secondaryKind === "MONEY"
                  ? formatMoney(String(segment.secondaryValue))
                  : new Intl.NumberFormat("pt-BR").format(Number(segment.secondaryValue));
            return (
              <li key={segment.id}>
                <Link className={styles.segmentLink} href={dashboardHref(query, segment.drilldownId)}>
                  <span className={styles.segmentRow}>
                    <span>{segment.label}</span>
                    <strong>
                      {segment.value.toLocaleString("pt-BR")}
                      {segment.percentage !== null ? ` · ${segment.percentage.toLocaleString("pt-BR")}%` : ""}
                    </strong>
                  </span>
                  <span aria-hidden="true" className={styles.barTrack}>
                    <span className={styles.barFill} style={{ width: `${(segment.value / max) * 100}%` }} />
                  </span>
                  {secondary !== null ? <span className={styles.segmentMeta}>{segment.secondaryLabel}: {secondary}</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function FunnelPanel({ segments, query }: Readonly<{ segments: readonly DashboardSegment[]; query: DashboardQuery }>) {
  const max = Math.max(1, ...segments.map((segment) => segment.value));
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><h2>Funil comercial</h2><p>Da entrada do lead ao ganho, sempre com registros reconciliáveis.</p></div>
      </header>
      {segments.length === 0 ? (
        <div className={styles.segmentEmpty}>Sem dados para este recorte. Nenhum segmento foi inventado.</div>
      ) : (
        <ol className={styles.funnelList}>
          {segments.map((segment) => (
            <li key={segment.id}>
              <Link className={styles.funnelItem} href={dashboardHref(query, segment.drilldownId)}>
                <span className={styles.funnelLabel}>{segment.label}</span>
                <span aria-hidden="true" className={styles.funnelTrack}>
                  <span
                    className={styles.funnelBar}
                    data-empty={segment.value === 0 ? "true" : "false"}
                    style={{ width: `${(segment.value / max) * 100}%` }}
                  />
                </span>
                <span className={styles.funnelConversion}>
                  <strong>{segment.value.toLocaleString("pt-BR")}</strong>
                  {segment.percentage !== null ? ` · ${segment.percentage.toLocaleString("pt-BR")}%` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AttentionPanel({ metrics, query }: Readonly<{ metrics: readonly DashboardKpi[]; query: DashboardQuery }>) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><h2>Precisa de atenção</h2><p>Pendências reais que pedem uma ação da equipe.</p></div>
        <Icon name="alerta" size={18} />
      </header>
      <ol className={styles.attentionList}>
        {metrics.map((metric) => (
          <li key={metric.id}>
            <Link className={styles.attentionLink} href={dashboardHref(query, metric.drilldownId)}>
              <span className={styles.attentionIcon}><Icon name={metricIcons[metric.id] ?? "alerta"} size={17} /></span>
              <span className={styles.attentionText}><strong>{metric.label}</strong><span>{metric.detail}</span></span>
              <strong className={styles.attentionValue}>{metricValue(metric)}</strong>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SelectFilter({
  name,
  label,
  options,
  selected,
}: Readonly<{
  name: string;
  label: string;
  options: readonly Readonly<{ id: string; name: string }>[];
  selected: readonly string[];
}>) {
  return (
    <label className={styles.field}>
      {label}
      <select defaultValue={selected} multiple name={name}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function greetingFor(generatedAt: string, timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(generatedAt)));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function periodLabel(fromDate: string, toDate: string) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
  const from = formatter.format(new Date(`${fromDate}T12:00:00Z`));
  const to = formatter.format(new Date(`${toDate}T12:00:00Z`));
  return `${from} a ${to}`;
}

export function DashboardView({
  basePath,
  displayName,
  roleKey,
  roleName,
  screen,
}: Readonly<{
  basePath: "/" | "/dashboard";
  displayName: string;
  roleKey: string;
  roleName: string;
  screen: DashboardScreen;
}>) {
  const q = screen.query;
  const activeFilterCount = Object.values(q.filters).reduce((total, values) => total + values.length, 0);
  const byId = new Map(screen.kpis.map((metric) => [metric.id, metric]));
  const primaryMetrics = ["revenue", "sales", "opportunities", "leads"].flatMap((id) => byId.get(id) ?? []);
  const secondaryMetrics = ["mrr", "tcv", "ticket", "proposals", "scheduled", "held", "qualified", "connected"].flatMap((id) => byId.get(id) ?? []);
  const attentionMetrics = ["no-next-action", "stalled", "no-show", "sla"].flatMap((id) => byId.get(id) ?? []);
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const operationalRole = ["administrator", "commercial_manager", "sdr"].includes(roleKey);
  const focusAction = operationalRole
    ? { href: "/meu-dia", label: "Ver Meu Dia" }
    : { href: "/oportunidades", label: "Abrir vendas" };
  const secondaryAction = operationalRole
    ? { href: "/pipeline", label: "Abrir pipeline" }
    : roleKey === "closer"
      ? { href: "/agenda", label: "Ver agenda" }
      : { href: "/leads", label: "Ver leads" };
  const scopeLabel = { WORKSPACE: "todo o workspace", TEAM: "sua equipe", OWN: "seus registros" }[screen.overview.scope];

  return (
    <div className={styles.dashboard}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Visão comercial</p>
          <h1>Dashboard comercial</h1>
          <p className={styles.heroIntro}><strong>{greetingFor(screen.overview.generatedAt, screen.overview.period.timeZone)}, {firstName}.</strong> Veja o resultado e onde a operação precisa agir agora.</p>
          <p className={styles.heroMeta}>{roleName} · {scopeLabel} · {periodLabel(q.fromDate, q.toDate)} · {screen.overview.period.timeZone}</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href={focusAction.href}>{focusAction.label} <Icon name="seta-direita" size={15} /></Link>
          <Link className={styles.secondaryAction} href={secondaryAction.href}>{secondaryAction.label}</Link>
        </div>
      </header>

      <section aria-label="Período e filtros do dashboard" className={styles.toolbar}>
        <nav aria-label="Atalhos de período" className={styles.periodNav}>
          {(["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map((preset) => {
            const names = { TODAY: "Hoje", YESTERDAY: "Ontem", WEEK: "Semana", MONTH: "Mês" };
            return (
              <Link
                aria-current={q.preset === preset ? "page" : undefined}
                className={`${styles.periodLink} ${q.preset === preset ? styles.periodActive : ""}`}
                href={`${basePath}?preset=${preset}`}
                key={preset}
              >
                {names[preset]}
              </Link>
            );
          })}
        </nav>

        <details className={styles.filterDetails} open={activeFilterCount > 0 || q.preset === "CUSTOM"}>
          <summary className={styles.filterSummary}>
            <Icon name="filtro" size={15} /> Filtros
            {activeFilterCount > 0 ? <span className={styles.filterCount}>{activeFilterCount}</span> : null}
          </summary>
          <div className={styles.filterPanel}>
            <div className={styles.filterPanelHeader}>
              <div><strong>Refinar análise</strong><span>Todos os filtros são aplicados no servidor e preservados no drilldown.</span></div>
            </div>
            <form className={styles.filterForm} method="get">
              <label className={styles.field}>Período
                <select defaultValue={q.preset} name="preset">
                  <option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="WEEK">Semana atual</option><option value="MONTH">Mês atual</option><option value="CUSTOM">Personalizado</option>
                </select>
              </label>
              <label className={styles.field}>Data inicial<input defaultValue={q.fromDate} name="fromDate" type="date" /></label>
              <label className={styles.field}>Data final<input defaultValue={q.toDate} name="toDate" type="date" /></label>
              <SelectFilter name="priority" label="Prioridade" options={screen.filterOptions.priorities} selected={q.filters.priorityCodes} />
              <SelectFilter name="sdr" label="SDR" options={screen.filterOptions.sdrs} selected={q.filters.sdrMemberIds} />
              <SelectFilter name="closer" label="Closer" options={screen.filterOptions.closers} selected={q.filters.closerMemberIds} />
              <SelectFilter name="team" label="Equipe" options={screen.filterOptions.teams} selected={q.filters.teamIds} />
              <SelectFilter name="source" label="Origem" options={screen.filterOptions.sources} selected={q.filters.sourceIds} />
              <SelectFilter name="campaign" label="Campanha" options={screen.filterOptions.campaigns} selected={q.filters.campaignIds} />
              <SelectFilter name="creative" label="Criativo" options={screen.filterOptions.creatives} selected={q.filters.creativeIds} />
              <SelectFilter name="product" label="Produto" options={screen.filterOptions.products} selected={q.filters.productIds} />
              <div className={styles.filterActions}>
                <Link className={styles.filterClear} href={`${basePath}?preset=MONTH`}>Limpar</Link>
                <button className={styles.filterApply} type="submit">Aplicar filtros</button>
              </div>
            </form>
          </div>
        </details>
      </section>

      {!screen.hasData ? (
        <section className={styles.emptyState}>
          <h2>Nenhum dado no período</h2>
          <p>Altere o período ou os filtros. Os indicadores permanecem zerados e nenhum gráfico exibe séries fictícias.</p>
        </section>
      ) : null}

      <section aria-labelledby="kpis-title">
        <header className={styles.sectionHeader}>
          <div><span className={styles.sectionTag}>Resultado do período</span><h2 id="kpis-title">Indicadores acionáveis</h2><p>Cada número abre exatamente os registros que o originaram.</p></div>
        </header>
        <div className={styles.kpiGrid}>
          {primaryMetrics.map((metric, index) => <MetricCard featured={index === 0} key={metric.id} metric={metric} query={q} />)}
        </div>
        <div className={styles.secondaryKpis}>
          {secondaryMetrics.map((metric) => <SmallKpi key={metric.id} metric={metric} query={q} />)}
        </div>
      </section>

      <div className={styles.mainGrid}>
        <FunnelPanel query={q} segments={screen.funnel} />
        <AttentionPanel metrics={attentionMetrics} query={q} />
      </div>

      <div className={styles.analysisGrid}>
        <SegmentList description="Quais canais trouxeram os leads do período." limit={6} query={q} segments={screen.sources} title="Origem dos leads" />
        <SegmentList description="Reuniões realizadas, show rate e receita persistida." limit={6} query={q} secondaryKind="MONEY" segments={screen.closerPerformance} title="Performance de closers" />
        <SegmentList description="Volume atribuído e taxa de primeira tentativa." limit={6} query={q} segments={screen.sdrPerformance} title="Performance de SDRs" />
        <SegmentList description="Distribuição vigente entre P1, P2 e P3." limit={3} query={q} segments={screen.priorities} title="Qualidade da entrada" />
      </div>

      <details className={styles.details}>
        <summary>Explorar análises detalhadas <span>Etapas, campanhas, PACTO, motivos e aging</span></summary>
        <div className={styles.detailsContent}>
          <SegmentList description="Entradas históricas por etapa e pipeline." query={q} segments={screen.stageConversion} title="Conversão por etapa" />
          <SegmentList description="Tempo médio calculado pelo histórico de etapas." query={q} secondaryKind="DURATION" segments={screen.stageTime} title="Tempo por etapa" />
          <SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.campaigns} title="Campanhas" />
          <SegmentList description="Distribuição dos leads recebidos." query={q} segments={screen.creatives} title="Criativos" />
          <SegmentList description="Completude humana da coorte de entrada." query={q} segments={screen.pactoQuality} title="Qualidade do PACTO" />
          <SegmentList description="Eventos de desqualificação no período." query={q} segments={screen.disqualificationReasons} title="Motivos de desqualificação" />
          <SegmentList description="Perdas vigentes ocorridas no período." query={q} segments={screen.lossReasons} title="Motivos de perda" />
          <SegmentList description="Último estado persistido das reuniões decididas." query={q} segments={screen.noShowReasons} title="Motivos de no-show" />
          <SegmentList description="Leads em intervalo aberto no corte." query={q} segments={screen.backlogByStage} title="Backlog por etapa" />
          <SegmentList description="Idade média do backlog pelo StageHistory." query={q} secondaryKind="DURATION" segments={screen.agingByStage} title="Aging por etapa" />
        </div>
      </details>
    </div>
  );
}
