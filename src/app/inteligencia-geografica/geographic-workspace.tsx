"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { getGeographicIntelligenceService } from "@/modules/geography/application/geographic-intelligence-service";
import styles from "./geographic.module.css";

type Screen = Awaited<ReturnType<ReturnType<typeof getGeographicIntelligenceService>["getScreen"]>>;
type Metric = Screen["metric"];
type Region = Screen["regions"][number];

const metricLabels: Record<Metric, string> = {
  LEADS: "Leads", ATTEMPTS: "Tentativas", CONTACTS: "Conectados", QUALIFIED: "Qualificados",
  MEETINGS: "Reuniões", NO_SHOWS: "No-shows", OPPORTUNITIES: "Oportunidades", PROPOSALS: "Propostas",
  WINS: "Ganhos", LOSSES: "Perdas", DISQUALIFIED: "Desqualificados", REVENUE: "Receita",
  CONVERSION: "Conversão", SLA: "SLA humano",
};
const stateGrid: Record<string, readonly [number, number]> = {
  RR: [1, 3], AP: [1, 6], AM: [2, 2], PA: [2, 5], AC: [3, 1], RO: [3, 3], TO: [3, 6],
  MA: [3, 8], PI: [4, 8], CE: [4, 10], RN: [4, 12], PB: [5, 11], PE: [5, 10], AL: [6, 10],
  SE: [6, 9], BA: [5, 8], MT: [4, 4], GO: [5, 5], DF: [5, 6], MS: [6, 4], MG: [6, 6],
  ES: [6, 8], RJ: [7, 7], SP: [7, 5], PR: [8, 5], SC: [9, 5], RS: [10, 4],
};
const inputClass = "h-10 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function money(value: string | null) {
  return value === null ? "Indisponível" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value) / 100);
}
function percent(basisPoints: number | null) { return basisPoints === null ? "Indisponível" : `${(basisPoints / 100).toFixed(1)}%`; }
function formatValue(metric: Metric, value: number | null) {
  if (value === null) return "Protegido";
  if (metric === "REVENUE") return money(String(value));
  if (metric === "CONVERSION") return percent(value);
  if (metric === "SLA") return `${value}s`;
  return new Intl.NumberFormat("pt-BR").format(value);
}
function period(from: string, to: string) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
  return `${formatter.format(new Date(from))} – ${formatter.format(new Date(to))}`;
}
function comparisonLabel(value: { difference: number | null; percentageBps: number | null }, metric?: Metric) {
  if (value.difference === null) return "Sem base anterior comparável";
  if (value.difference === 0) return "Estável frente ao período anterior";
  const direction = value.difference > 0 ? "acima" : "abaixo";
  return value.percentageBps === null ? `${formatValue(metric ?? "LEADS", Math.abs(value.difference))} ${direction}` : `${Math.abs(value.percentageBps / 100).toFixed(1)}% ${direction}`;
}
function formText(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function strengthBucket(value: number | null, maximum: number) {
  if (value === null) return 0;
  return Math.max(1, Math.min(5, Math.ceil((value / maximum) * 5)));
}

export function GeographicWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [metric, setMetric] = useState<Metric>(initial.metric);
  const [selectedKey, setSelectedKey] = useState<string | null>(initial.regions.find((row) => !row.belowMinimum)?.key ?? null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "backfill" } | { kind: "inactivate"; id: string; name: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ affectedProfiles: number; overlaps: readonly { name: string }[]; ambiguous: boolean } | null>(null);
  const rows = initial.regions;
  const periodDays = Math.round((new Date(initial.period.to).getTime() - new Date(initial.period.from).getTime()) / 86_400_000);
  const selected = rows.find((row) => row.key === selectedKey) ?? rows[0] ?? null;
  const max = Math.max(1, ...rows.flatMap((row) => row.value === null ? [] : [row.value]));
  const rankedRegions = [...rows].filter((row) => !row.belowMinimum && row.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5);
  const byState = useMemo(() => new Map(rows.map((row) => [row.stateCode, row])), [rows]);
  const activeFilters = [initial.query.stateCode, initial.query.territoryId, ...initial.query.sourceIds, ...initial.query.campaignIds, ...initial.query.creativeIds, ...initial.query.teamIds, ...initial.query.sdrMemberIds, ...initial.query.stageIds, ...initial.query.precisions, ...initial.query.evidenceClasses, ...initial.query.verificationStatuses, initial.query.minimumConfidenceBps].filter(Boolean).length;

  function navigate(change: Record<string, string | null>) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(change)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    router.push(`${url.pathname}${url.search}`);
  }
  function changeMetric(value: Metric) { setMetric(value); navigate({ metric: value }); }
  function selectPeriod(days: number) {
    const to = new Date(initial.generatedAt); const from = new Date(to.getTime() - days * 86_400_000);
    navigate({ from: from.toISOString(), to: to.toISOString() });
  }
  async function action(actionName: string, data: unknown) {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch("/api/geography", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, data }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a ação.");
      return body.result;
    } finally { setPending(false); }
  }
  async function backfill(mode: "DRY_RUN" | "EXECUTE", confirmed = false) {
    try {
      if (mode === "EXECUTE" && !confirmed) { setConfirmation({ kind: "backfill" }); return; }
      const result = await action("BACKFILL", { mode, idempotencyKey: `ui-${mode.toLowerCase()}-${crypto.randomUUID()}` });
      setFeedback(mode === "DRY_RUN" ? `Prévia: ${result.validCount} válidos, ${result.conflictCount} conflitos e ${result.noLocationCount} sem localização.` : `Backfill: ${result.createdCount} perfis e ${result.membershipsCreated ?? 0} vínculos territoriais criados.`);
      router.refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Falha no backfill."); }
  }
  function territoryPayload(form: FormData) {
    const type = formText(form, "type");
    return {
      code: formText(form, "code").toUpperCase(), name: formText(form, "name"), type,
      priority: Number(formText(form, "priority")), countryCode: formText(form, "countryCode").toUpperCase() || undefined,
      stateCode: formText(form, "stateCode").toUpperCase() || undefined,
      city: type === "CITY" ? formText(form, "city") || undefined : undefined,
      postalPrefix: type === "POSTAL_PREFIX" ? formText(form, "postalPrefix") || undefined : undefined,
      effectiveFrom: new Date(formText(form, "effectiveFrom")).toISOString(), reason: formText(form, "reason"),
    };
  }
  async function previewTerritory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const result = await action("PREVIEW_TERRITORY", territoryPayload(new FormData(event.currentTarget))); setPreview(result); setFeedback("Prévia territorial calculada sem mutação."); }
    catch (error) { setPreview(null); setFeedback(error instanceof Error ? error.message : "Falha na prévia."); }
  }
  async function publishTerritory(form: HTMLFormElement) {
    if (!preview || preview.ambiguous) return;
    try { await action("PUBLISH_TERRITORY", territoryPayload(new FormData(form))); setFeedback("Nova versão territorial publicada e auditada. Responsáveis não foram alterados."); setPreview(null); form.reset(); router.refresh(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Falha na publicação."); }
  }
  async function inactivateTerritory(id: string, name: string, confirmed = false) {
    if (!confirmed) { setConfirmation({ kind: "inactivate", id, name }); return; }
    try { await action("SET_TERRITORY_STATUS", { territoryId: id, status: "INACTIVE", reason: "Inativação confirmada na administração geográfica." }); setFeedback("Território inativado; fatos e vínculos históricos foram preservados."); router.refresh(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Falha na inativação."); }
  }

  return <div className={styles.workspace}>
    <div className={styles.context}><div><strong>Período</strong><span>{period(initial.period.from, initial.period.to)}</span></div><div><strong>Comparado com</strong><span>{period(initial.previousPeriod.from, initial.previousPeriod.to)}</span></div><div><strong>Privacidade</strong><span>Amostras menores que {initial.minimumGroupSize} registros são protegidas</span></div><div><strong>Atualizado</strong><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(initial.generatedAt))}</span></div></div>

    <Surface className={styles.filterBar} aria-label="Filtros geográficos">
      <label>Período<select className={inputClass} value={String(periodDays)} onChange={(event) => selectPeriod(Number(event.target.value))}>{![7, 30, 90].includes(periodDays) ? <option disabled value={String(periodDays)}>Personalizado</option> : null}<option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label>
      <label>Território<select className={inputClass} onChange={(event) => navigate({ territoryId: event.target.value || null })} value={initial.query.territoryId ?? ""}><option value="">Todos</option>{initial.filters.territories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Origem<select className={inputClass} onChange={(event) => navigate({ sourceIds: event.target.value || null })} value={initial.query.sourceIds[0] ?? ""}><option value="">Todas</option>{initial.filters.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <details className={styles.advanced}><summary>Filtros avançados{activeFilters ? ` · ${activeFilters}` : ""}</summary><div className={styles.advancedGrid}>
        <label>Etapa<select className={inputClass} onChange={(event) => navigate({ stageIds: event.target.value || null })} value={initial.query.stageIds[0] ?? ""}><option value="">Todas</option>{initial.filters.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Equipe<select className={inputClass} onChange={(event) => navigate({ teamIds: event.target.value || null })} value={initial.query.teamIds[0] ?? ""}><option value="">Todas</option>{initial.filters.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Responsável<select className={inputClass} onChange={(event) => navigate({ sdrMemberIds: event.target.value || null })} value={initial.query.sdrMemberIds[0] ?? ""}><option value="">Todos</option>{initial.filters.members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Precisão<select className={inputClass} onChange={(event) => navigate({ precisions: event.target.value || null })} value={initial.query.precisions[0] ?? ""}><option value="">Todas</option><option value="COUNTRY">País</option><option value="STATE">UF</option><option value="CITY">Município</option><option value="POSTAL_PREFIX">Prefixo postal</option><option value="APPROXIMATE_POINT">Ponto aproximado</option><option value="EXACT_POINT">Ponto exato verificado</option></select></label>
        <label>Confiança mínima<select className={inputClass} onChange={(event) => navigate({ minimumConfidenceBps: event.target.value || null })} value={initial.query.minimumConfidenceBps ?? ""}><option value="">Qualquer</option><option value="7500">75%</option><option value="8500">85%</option><option value="10000">100%</option></select></label>
        <Button onClick={() => router.push("/inteligencia-geografica")} type="button" variant="secondary">Limpar filtros</Button>
      </div></details>
    </Surface>

    <section className={styles.kpis} aria-label="Resumo geográfico">{[
      { label: "Leads recebidos", value: initial.summary.leads.toLocaleString("pt-BR"), hint: comparisonLabel(initial.comparison.leads) },
      { label: "Cobertura geográfica", value: percent(initial.summary.coverageBps), hint: `${initial.summary.located} localizados · ${initial.summary.withoutLocation} sem localização` },
      { label: "Receita por território", value: money(initial.summary.revenueCents), hint: `${initial.summary.wins} ganhos · ${comparisonLabel(initial.comparison.revenueCents, "REVENUE")}` },
      { label: "SLA humano mediano", value: initial.summary.medianSlaSeconds === null ? "Sem amostra" : `${initial.summary.medianSlaSeconds}s`, hint: `${initial.summary.openIssues} divergências abertas` },
    ].map((item) => <article className={styles.stat} key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.hint}</small></article>)}</section>

    <div className={styles.controls}><div role="group" aria-label="Métrica do mapa">{(Object.keys(metricLabels) as Metric[]).map((key) => <button aria-pressed={metric === key} className={styles.metricButton} key={key} onClick={() => changeMetric(key)} type="button">{metricLabels[key]}</button>)}</div>{initial.permissions.canBackfill ? <div className={styles.backfill}><Button disabled={pending} onClick={() => void backfill("DRY_RUN")} size="sm" variant="secondary">Revisar localizações</Button><Button disabled={pending} onClick={() => void backfill("EXECUTE")} size="sm">Vincular localizações</Button></div> : null}</div>
    {feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}

    <div className={styles.primaryGrid}>
      <Surface className={styles.mapPanel}><SectionHeader title="Distribuição por região" description={`Explore ${metricLabels[metric].toLowerCase()} por estado. Selecione uma UF para abrir seus indicadores.`} />
        <div className={styles.mapAndLegend}><div aria-label={`Mapa esquemático do Brasil por ${metricLabels[metric]}`} className={styles.map} role="group">{Object.keys(stateGrid).map((state) => { const data = byState.get(state); const value = data?.value ?? null; return data ? <button aria-label={`${state}: ${formatValue(metric, value)}. Mostrar detalhes.`} aria-pressed={selected?.key === data.key} className={styles.state} data-state={state} data-strength={strengthBucket(value, max)} key={state} onClick={() => setSelectedKey(data.key)} title={`${state} · ${formatValue(metric, value)}`} type="button">{state}</button> : <span aria-label={`${state}: sem dados`} className={`${styles.state} ${styles.stateEmpty}`} data-state={state} data-strength="0" key={state}>{state}</span>; })}</div><div className={styles.regionBars}><h3>Comparação regional</h3><p>{metricLabels[metric]} · maior valor primeiro</p>{rankedRegions.map((region) => <button aria-pressed={selected?.key === region.key} key={region.key} onClick={() => setSelectedKey(region.key)} type="button"><span>{region.label}<strong>{formatValue(metric, region.value)}</strong></span><progress max={max} value={region.value ?? 0} aria-label={`${region.label}: ${formatValue(metric, region.value)}`} /></button>)}{!rankedRegions.length ? <p>Sem amostras disponíveis para comparação.</p> : null}</div><div className={styles.legend}><span>Menor</span><i /><i /><i /><i /><span>Maior</span><p>“Protegido” significa amostra abaixo do limiar, não valor zero.</p></div></div>{!rows.some((row) => row.stateCode) ? <p className={styles.mapEmpty}>Ainda não há dados regionais neste período. Estados sem registros aparecem sem preenchimento.</p> : null}
      </Surface>
      <RegionDetail metric={metric} region={selected} minimum={initial.minimumGroupSize} />
    </div>

    <Surface><SectionHeader title="Funil geográfico" description="Acompanhe a jornada comercial dos leads no território selecionado." /><div className={styles.funnel}>{[["Entrada", initial.funnel.leads], ["Tentativa", initial.funnel.attempts], ["Contato", initial.funnel.contacts], ["Qualificação", initial.funnel.qualified], ["Reunião", initial.funnel.meetings], ["Oportunidade", initial.funnel.opportunities], ["Proposta", initial.funnel.proposals], ["Ganho", initial.funnel.wins]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong><progress max={Math.max(1, initial.funnel.leads, initial.funnel.attempts, initial.funnel.contacts, initial.funnel.qualified, initial.funnel.meetings, initial.funnel.opportunities, initial.funnel.proposals, initial.funnel.wins)} value={Number(value)} aria-label={`${label}: ${value}`} /></div>)}</div><div className={styles.outcomes}><span>Saídas no período</span><strong>{initial.funnel.losses} perdas</strong><strong>{initial.funnel.disqualified} desqualificados</strong><strong>{initial.funnel.noShows} no-shows</strong></div></Surface>

    <div className={styles.lowerGrid}><Surface><SectionHeader title="Ranking regional" description="Compare o volume, a conversão e os resultados de cada região." /><DataTableShell className="mt-4"><table><thead><tr><th>UF</th><th>Leads</th><th>Contatos</th><th>Qualificados</th><th>Ganhos</th><th>Receita</th><th>Conversão</th><th>SLA</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td><button className={styles.tableLink} onClick={() => setSelectedKey(row.key)} type="button">{row.label}</button></td>{row.belowMinimum || !row.totals ? <td colSpan={7}>Amostra protegida · menos de {initial.minimumGroupSize} registros</td> : <><td>{row.totals.leads}</td><td>{row.totals.contacts}</td><td>{row.totals.qualified}</td><td>{row.totals.wins}</td><td>{money(row.totals.revenueCents)}</td><td>{percent(row.totals.conversionBps)}</td><td>{row.totals.medianSlaSeconds === null ? "Sem tentativa" : `${row.totals.medianSlaSeconds}s`}</td></>}</tr>)}</tbody></table></DataTableShell></Surface>
      <Surface tone="subtle">
        <SectionHeader title="Aquisição e qualidade" description="Principais origens, campanhas e criativos do recorte." />
        <AcquisitionGroup title="Origens" items={initial.acquisition.sources} />
        <AcquisitionGroup title="Campanhas" items={initial.acquisition.campaigns} />
        <AcquisitionGroup title="Criativos" items={initial.acquisition.creatives} />
        <p className={styles.unavailable}>CPL, CAC e ROAS: indisponíveis até existir custo real reconciliado.</p>
      </Surface>
    </div>

    <Surface id="territorios"><SectionHeader title="Territórios comerciais" description="Organize a cobertura comercial por país, estado, município ou região." />
      {initial.permissions.canManage ? <details className={styles.territoryEditor}><summary>Criar território comercial</summary><TerritoryForm onDraftChange={() => setPreview(null)} pending={pending} preview={preview} onPreview={previewTerritory} onPublish={publishTerritory} /></details> : null}
      <DataTableShell className="mt-4"><table><thead><tr><th>Código</th><th>Território</th><th>Tipo</th><th>Versão</th><th>Prioridade</th><th>Status</th><th>Ação</th></tr></thead><tbody>{initial.territoryDefinitions.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{row.type}</td><td>v{row.version}</td><td>{row.priority}</td><td>{row.status === "ACTIVE" ? "Ativo" : row.status === "INACTIVE" ? "Inativo" : "Rascunho"}</td><td>{initial.permissions.canManage && row.status === "ACTIVE" ? <button className={styles.tableLink} disabled={pending} onClick={() => void inactivateTerritory(row.id, row.name)} type="button">Inativar</button> : "—"}</td></tr>)}</tbody></table></DataTableShell>
    </Surface>
    {confirmation ? <AccessibleDialog busy={pending} className={styles.confirmDialog!} labelledBy="geography-confirm-title" onDismiss={() => setConfirmation(null)}><h2 id="geography-confirm-title">{confirmation.kind === "backfill" ? "Vincular localizações" : `Inativar ${confirmation.name}?`}</h2><p>{confirmation.kind === "backfill" ? "Serão aplicadas apenas as localizações explícitas já registradas. Os responsáveis e as coordenadas não serão alterados." : "O território deixará de ser usado em novos vínculos. O histórico será preservado."}</p><div><Button disabled={pending} onClick={() => setConfirmation(null)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending} onClick={() => { const confirmed = confirmation; setConfirmation(null); if (confirmed.kind === "backfill") void backfill("EXECUTE", true); else void inactivateTerritory(confirmed.id, confirmed.name, true); }} type="button">Confirmar</Button></div></AccessibleDialog> : null}
  </div>;
}

function RegionDetail({ metric, region, minimum }: Readonly<{ metric: Metric; region: Region | null; minimum: number }>) {
  if (!region) return <Surface tone="accent" className={styles.detailPanel}><EmptyState title="Nenhuma região no período" description="Altere o período ou remova filtros para ampliar o universo." /></Surface>;
  if (region.belowMinimum || !region.totals) return <Surface tone="accent" className={styles.detailPanel}><SectionHeader title={region.label} description={`Amostra menor que ${minimum}; valores exatos foram suprimidos.`} /><p>A proteção vale para mapa, tabela, comparação e aquisição.</p></Surface>;
  return <Surface tone="accent" className={styles.detailPanel}><SectionHeader eyebrow="Região selecionada" title={region.label} description={`${metricLabels[metric]}: ${formatValue(metric, region.value)}`} /><div className={styles.conversion}><span>Conversão regional</span><strong>{percent(region.totals.conversionBps)}</strong><progress max={10000} value={region.totals.conversionBps ?? 0} aria-label="Conversão regional" /></div><dl><div><dt>Leads</dt><dd>{region.totals.leads}</dd></div><div><dt>Conectados</dt><dd>{region.totals.contacts}</dd></div><div><dt>Qualificados</dt><dd>{region.totals.qualified}</dd></div><div><dt>Reuniões</dt><dd>{region.totals.meetings}</dd></div><div><dt>Ganhos</dt><dd>{region.totals.wins}</dd></div><div><dt>Receita</dt><dd>{money(region.totals.revenueCents)}</dd></div></dl><p>{comparisonLabel(region.comparison, metric)}. A variação é descritiva e não atribui causa.</p><Button asChild size="sm" variant="secondary"><Link href={region.drilldownUrl}>Abrir leads da região</Link></Button></Surface>;
}

function AcquisitionGroup({ title, items }: Readonly<{ title: string; items: Screen["acquisition"]["sources"] }>) {
  return <div><h3>{title}</h3><ul className={styles.ranking}>{items.length ? items.map((row) => <li key={row.id}><span>{row.name}</span><strong>{row.belowMinimum ? "Protegido" : row.count}</strong></li>) : <li><span>Sem dados no recorte</span></li>}</ul></div>;
}

function TerritoryForm({ pending, preview, onPreview, onPublish, onDraftChange }: Readonly<{ onDraftChange: () => void; pending: boolean; preview: { affectedProfiles: number; overlaps: readonly { name: string }[]; ambiguous: boolean } | null; onPreview: (event: FormEvent<HTMLFormElement>) => void; onPublish: (form: HTMLFormElement) => void }>) {
  return <form className={styles.territoryForm} onChange={onDraftChange} onSubmit={onPreview}><label>Código<input className={inputClass} name="code" pattern="[A-Za-z0-9][A-Za-z0-9_-]+" placeholder="BR-PR" required /></label><label>Nome<input className={inputClass} name="name" placeholder="Paraná" required /></label><label>Tipo<select className={inputClass} defaultValue="STATE" name="type"><option value="COUNTRY">País</option><option value="REGION">Região</option><option value="STATE">UF</option><option value="CITY">Município</option><option value="POSTAL_PREFIX">Prefixo postal</option></select></label><label>País<input className={inputClass} defaultValue="BR" maxLength={2} name="countryCode" /></label><label>UF<input className={inputClass} maxLength={2} name="stateCode" placeholder="PR" /></label><label>Município<input className={inputClass} name="city" /></label><label>Prefixo postal<input className={inputClass} name="postalPrefix" /></label><label>Prioridade<input className={inputClass} defaultValue="450" min="0" max="10000" name="priority" required type="number" /></label><label>Vigência<input className={inputClass} defaultValue="2026-01-01T00:00" name="effectiveFrom" required type="datetime-local" /></label><label className={styles.reason}>Motivo<input className={inputClass} minLength={5} name="reason" placeholder="Cobertura comercial aprovada" required /></label><div className={styles.formActions}><Button disabled={pending} type="submit" variant="secondary">Calcular impacto</Button><Button disabled={pending || !preview || preview.ambiguous} onClick={(event) => onPublish(event.currentTarget.form!)} type="button">Publicar nova versão</Button></div>{preview ? <p className={preview.ambiguous ? styles.previewWarning : styles.previewOk} role="status">{preview.affectedProfiles} perfis afetados · {preview.overlaps.length} sobreposições. {preview.ambiguous ? "Há empate de prioridade; ajuste antes de publicar." : "Prévia apta para confirmação."}</p> : null}</form>;
}
