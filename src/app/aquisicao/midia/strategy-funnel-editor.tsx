"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SectionHeader, Surface } from "@/components/ui/surface";
import type { getStrategyFunnelService } from "@/modules/marketing/application/strategy-funnel-service";
import type { StrategyFunnelDefinition, StrategyNodeType } from "@/modules/marketing/domain/strategy-funnel-contracts";
import styles from "./strategy-funnel.module.css";

export type StrategyFunnelScreen = Awaited<ReturnType<ReturnType<typeof getStrategyFunnelService>["screen"]>>;
type Draft = { id: string | null; name: string; description: string; revision: number | null; definition: StrategyFunnelDefinition };
const labels: Record<StrategyNodeType, string> = { LANDING_PAGE: "Página", FORM: "Formulário", WHATSAPP: "WhatsApp", COMMERCIAL_STAGE: "Etapa comercial" };
const money = (value: string | null) => value === null ? "Sem base" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);

function draftFrom(strategy: StrategyFunnelScreen["strategies"][number] | undefined): Draft {
  return strategy ? { id: strategy.id, name: strategy.name, description: strategy.description, revision: strategy.revision, definition: strategy.definition } : { id: null, name: "Nova estratégia", description: "", revision: null, definition: { schema: "strategy.funnel/v1", nodes: [{ id: "00000000-0000-4000-8000-000000000001", type: "WHATSAPP", label: "Primeiro contato no WhatsApp", referenceId: null }, { id: "00000000-0000-4000-8000-000000000002", type: "WHATSAPP", label: "Conversa qualificada", referenceId: null }] } };
}

export function StrategyFunnelEditor({ initial }: Readonly<{ initial: StrategyFunnelScreen }>) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initial.strategies[0]?.id ?? "new");
  const selected = initial.strategies.find((strategy) => strategy.id === selectedId);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(selected));
  const [addType, setAddType] = useState<StrategyNodeType>("LANDING_PAGE");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const metrics = useMemo(() => new Map((selected?.nodes ?? []).map((node) => [node.id, node])), [selected]);
  const edges = useMemo(() => new Map((selected?.edges ?? []).map((edge) => [`${edge.fromNodeId}:${edge.toNodeId}`, edge])), [selected]);

  function references(type: StrategyNodeType) {
    if (type === "LANDING_PAGE") return initial.catalog.pages.map((item) => ({ id: item.id, label: `${item.name} · ${item.canonicalUrl}` }));
    if (type === "FORM") return initial.catalog.forms.map((item) => ({ id: item.id, label: item.name }));
    if (type === "COMMERCIAL_STAGE") return initial.catalog.pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => ({ id: stage.id, label: `${pipeline.name} · ${stage.name}` })));
    return [];
  }
  function patchNode(id: string, patch: Partial<StrategyFunnelDefinition["nodes"][number]>) { setDraft((current) => ({ ...current, definition: { ...current.definition, nodes: current.definition.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) } })); }
  function addNode() { const available = references(addType); setDraft((current) => ({ ...current, definition: { ...current.definition, nodes: [...current.definition.nodes, { id: crypto.randomUUID(), type: addType, label: labels[addType], referenceId: addType === "WHATSAPP" ? null : available[0]?.id ?? null }] } })); }
  function move(index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= draft.definition.nodes.length) return; const nodes = [...draft.definition.nodes]; [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!]; setDraft((current) => ({ ...current, definition: { ...current.definition, nodes } })); }
  function remove(id: string) { if (draft.definition.nodes.length <= 2) return; setDraft((current) => ({ ...current, definition: { ...current.definition, nodes: current.definition.nodes.filter((node) => node.id !== id) } })); }
  async function command(body: unknown) { setPending(true); setFeedback(null); try { const response = await fetch("/api/marketing/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Não foi possível salvar a estratégia."); setFeedback("Estratégia salva e métricas recalculadas."); router.refresh(); return payload.result as { id?: string; revision?: number }; } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível salvar a estratégia."); return null; } finally { setPending(false); } }
  async function save() { const payload = { name: draft.name, description: draft.description, definition: draft.definition }; const result = await command(draft.id ? { action: "UPDATE", id: draft.id, payload: { ...payload, expectedRevision: draft.revision } } : { action: "CREATE", payload: { ...payload, idempotencyKey: `strategy:${crypto.randomUUID()}` } }); if (result?.id) { setSelectedId(result.id); setDraft((current) => ({ ...current, id: result.id ?? current.id, revision: result.revision ?? current.revision })); } }
  async function archive() { if (draft.id && draft.revision && await command({ action: "ARCHIVE", id: draft.id, expectedRevision: draft.revision })) setSelectedId("new"); }

  return <Surface className={styles.editorPanel}>
    <SectionHeader title="Editor de estratégias" description="Desenhe a jornada real e acompanhe volume, conversão identificada e custo acumulado entre as etapas." />
    <div className={styles.editorToolbar}><label>Estratégia<select value={selectedId} onChange={(event) => { const id = event.target.value; setSelectedId(id); setDraft(draftFrom(initial.strategies.find((strategy) => strategy.id === id))); }}><option value="new">+ Nova estratégia</option>{initial.strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label><label>Nome<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label className={styles.description}>Descrição<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label></div>
    <ol className={styles.editorFlow}>{draft.definition.nodes.map((node, index) => { const measured = metrics.get(node.id); const next = draft.definition.nodes[index + 1]; const edge = next ? edges.get(`${node.id}:${next.id}`) : null; const options = references(node.type); return <li className={styles.editorStageWrap} key={node.id}><article className={styles.editorStage}><div className={styles.stageHead}><span>{labels[node.type]}</span><div><button disabled={index === 0} onClick={() => move(index, -1)} type="button" aria-label={`Mover ${node.label} para a esquerda`}>←</button><button disabled={index === draft.definition.nodes.length - 1} onClick={() => move(index, 1)} type="button" aria-label={`Mover ${node.label} para a direita`}>→</button><button disabled={draft.definition.nodes.length <= 2} onClick={() => remove(node.id)} type="button" aria-label={`Remover ${node.label}`}>×</button></div></div><input aria-label={`Nome da etapa ${index + 1}`} value={node.label} onChange={(event) => patchNode(node.id, { label: event.target.value })} />{node.type !== "WHATSAPP" ? <select aria-label={`Referência da etapa ${index + 1}`} value={node.referenceId ?? ""} onChange={(event) => patchNode(node.id, { referenceId: event.target.value || null })}><option value="">Selecione</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <small>Conversas de vendas no canal WhatsApp</small>}<dl><div><dt>Volume</dt><dd>{measured ? measured.volume.toLocaleString("pt-BR") : "Salvar para medir"}</dd></div><div><dt>Custo por resultado</dt><dd>{measured ? money(measured.costPerResultCents) : "—"}</dd></div></dl>{measured ? <small>{measured.provenance} · cobertura {measured.coverage === "COMPLETE" ? "completa" : "parcial"}</small> : null}</article>{edge ? <div className={styles.edgeMetric}><strong>{edge.conversionBps === null ? "Sem base comparável" : `${(edge.conversionBps / 100).toFixed(1)}%`}</strong><span>{edge.converted === null ? "Identidade não vinculada" : `${edge.converted}/${edge.denominator} ${edge.grain === "LEAD" ? "leads" : "sessões"}`}</span><small>{edge.costPerConversionCents ? `${money(edge.costPerConversionCents)} por conversão` : "Custo indisponível"}</small></div> : null}</li>; })}</ol>
    <div className={styles.addRow}><select value={addType} onChange={(event) => setAddType(event.target.value as StrategyNodeType)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button onClick={addNode} size="sm" variant="secondary">Adicionar etapa</Button><span className={styles.spacer} /><Button disabled={pending || !draft.name.trim() || draft.definition.nodes.some((node) => !node.label.trim() || (node.type !== "WHATSAPP" && !node.referenceId))} onClick={() => void save()} size="sm">{pending ? "Salvando…" : "Salvar estratégia"}</Button>{draft.id ? <Button disabled={pending} onClick={() => void archive()} size="sm" variant="ghost">Arquivar</Button> : null}</div>
    {feedback ? <p role="status" className={styles.feedback}>{feedback}</p> : null}<p className={styles.method}>{initial.costMethod} Investimento confirmado no período: {money(initial.totalSpendCents)}.</p>
  </Surface>;
}
