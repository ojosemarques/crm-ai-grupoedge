"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePostSalesActionDialog } from "@/app/onboarding/post-sales-action-dialog";
import styles from "@/app/onboarding/post-sales.module.css";

type RenewalStatus = "IN_REVIEW" | "RENEWED" | "NOT_RENEWED" | "DEFERRED" | "CANCELLED";
type RiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Item = Readonly<{
  id: string; accountId: string; accountName: string; ownerMemberId: string; ownerName: string; teamId: string | null;
  targetDate: string; status: RenewalStatus; riskLevel: RiskLevel; riskEvidence: string | null;
  baseMrrCents: string; baseTcvCents: string; currency: "BRL"; nextActionDescription: string | null;
  nextActionAt: string | null; revision: number; priorityRank: number; priorityReason: string;
  pendingExpansion: number; revenueDecisions: number;
  subscription: Readonly<{ id: string; subscriptionNumber: string; status: string; productNameSnapshot: string; currentMrrCents: string; endsAt: string | null }> | null;
}>;
export type FarmerScreenView = Readonly<{
  generatedAt: string; timeZone: string; total: number; items: readonly Item[];
  metrics: Readonly<{ due30: number; due60: number; due90: number; mrrAtRiskCents: string; renewed: number; notRenewed: number; deferred: number; renewalRate: number | null; missingNextAction: number; pendingExpansion: number }>;
  formulas: Readonly<{ renewalRate: string; priority: string }>;
  members: readonly Readonly<{ id: string; name: string }>[];
  permissions: Readonly<{ write: boolean; confirm: boolean; expansion: boolean; expansionConfirm: boolean; revenue: boolean; correct: boolean }>;
}>;
type Detail = Readonly<{
  events: readonly Readonly<{ id: string; type: string; reason: string; occurredAt: string }>[];
  signals: readonly Readonly<{ id: string; status: string; type: string; evidence: string; revision: number }>[];
  decisions: readonly Readonly<{ id: string; type: string; status: string; deltaMrrCents: string; reasonCode: string; effectiveAt: string }>[];
  ledger: readonly Readonly<{ id: string; type: string; deltaMrrCents: string; effectiveAt: string }>[];
}>;

const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(BigInt(value)) / 100);
const date = (value: string | null, timeZone: string) => value ? new Date(value).toLocaleString("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }) : "Sem prazo";
const tone = { NONE: "neutral", LOW: "info", MEDIUM: "warning", HIGH: "danger", CRITICAL: "danger" } as const;
const riskLabels = { NONE: "Sem risco confirmado", LOW: "Baixo", MEDIUM: "Médio", HIGH: "Alto", CRITICAL: "Crítico" } as const;
const labels = { IN_REVIEW: "Em revisão", RENEWED: "Renovada", NOT_RENEWED: "Não renovada", DEFERRED: "Adiada", CANCELLED: "Cancelada" } as const;
const idem = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;
const terminalStatus = (status: RenewalStatus) => ["RENEWED", "NOT_RENEWED", "CANCELLED"].includes(status);

async function responseBody(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? "Não foi possível concluir a ação.");
  return data.result;
}

export function FarmerWorkspace({ screen }: { screen: FarmerScreenView }) {
  const actionDialog = usePostSalesActionDialog();
 const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [detail, setDetail] = useState<{ id: string; data: Detail } | null>(null);

  async function run(operation: () => Promise<Response>, message: string) {
    setPending(true); setNotice(null);
    try { await responseBody(await operation()); setNotice({ kind: "success", message }); router.refresh(); }
    catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." }); }
    finally { setPending(false); }
  }
  async function load(item: Item) {
    setPending(true);
    try { setDetail({ id: item.id, data: await responseBody(await fetch(`/api/farmer/${item.id}`)) }); }
    catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao abrir detalhes." }); }
    finally { setPending(false); }
  }
  async function risk(item: Item) {
    const level = (await actionDialog.prompt("Nível de risco", item.riskLevel, { options: [{ value: "NONE", label: "Sem risco confirmado" }, { value: "LOW", label: "Baixo" }, { value: "MEDIUM", label: "Médio" }, { value: "HIGH", label: "Alto" }, { value: "CRITICAL", label: "Crítico" }] }))?.toUpperCase();
    if (!level || !["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) return;
    const evidence = level === "NONE" ? undefined : (await actionDialog.prompt("Evidência observada do risco:"))?.trim();
    if (level !== "NONE" && !evidence) return;
    await run(() => fetch(`/api/farmer/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SET_RISK", expectedRevision: item.revision, riskLevel: level, riskReasonCode: level === "NONE" ? undefined : "CUSTOMER_EVIDENCE", evidence, reason: "Risco revisado explicitamente pelo responsável.", idempotencyKey: idem("renewal-risk") }) }), "Risco atualizado com evidência e auditoria.");
  }
  async function decide(item: Item, action: "RENEW" | "NOT_RENEW" | "CANCEL") {
    const comment = (await actionDialog.prompt("Descreva o motivo e a evidência da decisão:"))?.trim();
    if (!comment || comment.length < 3 || !(await actionDialog.confirm(`Confirmar ${action} para ${item.accountName}? O impacto será registrado e auditado.`))) return;
    await run(() => fetch(`/api/farmer/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedRevision: item.revision, reasonCode: action === "RENEW" ? "RENEWED_CONFIRMED" : "CUSTOMER_DECISION", comment, idempotencyKey: idem(`renewal-${action.toLowerCase()}`) }) }), "Decisão de renovação registrada explicitamente.");
  }
  async function defer(item: Item) {
    const targetDate = (await actionDialog.prompt("Nova data-alvo", "", { type: "date" }));
    if (!targetDate) return;
    const nextAction = (await actionDialog.prompt("Próxima ação:"))?.trim();
    if (!nextAction) return;
    const comment = (await actionDialog.prompt("Motivo do adiamento:"))?.trim();
    if (!targetDate || !nextAction || !comment || !(await actionDialog.confirm(`Adiar a renovação de ${item.accountName}?`))) return;
    const nextActionAt = new Date(`${targetDate}T12:00:00-03:00`);
    await run(() => fetch(`/api/farmer/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "DEFER", expectedRevision: item.revision, targetDate: nextActionAt.toISOString(), nextActionDescription: nextAction, nextActionAt: nextActionAt.toISOString(), reasonCode: "REVIEW_DEFERRED", comment, idempotencyKey: idem("renewal-defer") }) }), "Renovação adiada com próxima ação explícita.");
  }
  async function reopen(item: Item) {
    const nextAction = (await actionDialog.prompt("Próxima ação da reabertura:"))?.trim();
    if (!nextAction) return;
    const reason = (await actionDialog.prompt("Motivo da reabertura:"))?.trim();
    if (!nextAction || !reason || !(await actionDialog.confirm(`Reabrir a renovação de ${item.accountName}?`))) return;
    await run(() => fetch(`/api/farmer/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REOPEN", expectedRevision: item.revision, nextActionDescription: nextAction, nextActionAt: new Date(new Date(screen.generatedAt).getTime() + 86_400_000).toISOString(), reason, idempotencyKey: idem("renewal-reopen") }) }), "Renovação reaberta sem apagar a decisão anterior.");
  }
  async function addSignal(item: Item) {
    const evidence = (await actionDialog.prompt("Qual evidência indica potencial de expansão?"))?.trim();
    if (!evidence || evidence.length < 3) return;
    await run(() => fetch("/api/farmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CREATE_SIGNAL", payload: { accountId: item.accountId, subscriptionId: item.subscription?.id ?? null, type: "UPSELL", source: "FARMER_REVIEW", evidence, capturedAt: new Date().toISOString(), estimatedMrrCents: "0", estimatedTcvCents: "0", idempotencyKey: idem("expansion-signal") } }) }), "Sinal registrado. Ele não cria receita nem oportunidade sem confirmação humana.");
  }
  async function reviewSignal(signal: Detail["signals"][number], action: "REJECT" | "CONFIRM_AND_LINK") {
    const comment = (await actionDialog.prompt(action === "REJECT" ? "Motivo da rejeição:" : "Evidência da confirmação:"))?.trim();
    if (!comment) return;
    const payload: Record<string, unknown> = { signalId: signal.id, action, expectedRevision: signal.revision, reasonCode: action === "REJECT" ? "NO_FIT" : "EXPANSION_CONFIRMED", comment, idempotencyKey: idem("expansion-review") };
    if (action === "CONFIRM_AND_LINK") {
      const nextActionDescription = (await actionDialog.prompt("Próxima ação comercial:"))?.trim();
      if (!nextActionDescription || !(await actionDialog.confirm("Criar oportunidade rastreável a partir deste sinal?"))) return;
      payload.nextActionDescription = nextActionDescription;
      payload.nextActionAt = new Date(new Date(screen.generatedAt).getTime() + 86_400_000).toISOString();
    }
    await run(() => fetch("/api/farmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REVIEW_SIGNAL", payload }) }), action === "REJECT" ? "Sinal rejeitado com motivo." : "Sinal confirmado e oportunidade criada.");
  }
  async function revenue(item: Item, type: "CONTRACTION" | "CHURN") {
    const subscription = item.subscription; if (!subscription) return;
    const newValue = type === "CHURN" ? "0" : (await actionDialog.prompt("Novo MRR em centavos", "", { type: "number" }));
    if (newValue === null) return;
    const evidence = (await actionDialog.prompt("Evidência e confirmação do cliente:"))?.trim();
    const learning = type === "CHURN" ? (await actionDialog.prompt("Aprendizado para evitar ou antecipar perdas semelhantes:"))?.trim() : undefined;
    if (newValue === null || !evidence || (type === "CHURN" && (!learning || learning.length < 8)) || !(await actionDialog.confirm(`Confirmar ${type} de ${money(subscription.currentMrrCents)} para ${money(newValue)}? Um movimento será registrado no histórico.`))) return;
    await run(() => fetch("/api/farmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REVENUE_DECISION", payload: { subscriptionId: subscription.id, renewalId: item.id, type, newMrrCents: newValue, effectiveAt: new Date().toISOString(), reasonCode: type === "CHURN" ? "CUSTOMER_CANCELLED" : "SCOPE_REDUCTION", comment: evidence, evidence, learning, logoChurn: type === "CHURN", revenueChurn: true, idempotencyKey: idem(`farmer-${type.toLowerCase()}`) } }) }), "Decisão financeira registrada com movimento de receita rastreável.");
  }
  async function correctDecision(decision: Detail["decisions"][number]) {
    const reason = (await actionDialog.prompt("Motivo documentado da reversão:"))?.trim();
    if (!reason || reason.length < 8 || !(await actionDialog.confirm("Criar movimento reversor sem apagar o fato original?"))) return;
    await run(() => fetch("/api/farmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CORRECT_DECISION", payload: { decisionId: decision.id, reason, idempotencyKey: idem("farmer-correction") } }) }), "Correção registrada por reversão append-only.");
  }

  const cards = [
    ["Renovações 30d", screen.metrics.due30, "?windowDays=30"],
    ["MRR em renovação", money(screen.metrics.mrrAtRiskCents), ""],
    ["Taxa de renovação", screen.metrics.renewalRate === null ? "Indisponível" : `${Math.round(screen.metrics.renewalRate * 100)}%`, ""],
    ["Expansões pendentes", screen.metrics.pendingExpansion, "?action=EXPANSION"],
    ["Sem próxima ação", screen.metrics.missingNextAction, "?action=MISSING"],
  ] as const;

  return <div className={styles.workspace}>
    <section aria-label="Indicadores Farmer" className={styles.metrics}>{cards.map(([label, value, href]) => <a className={styles.metric} href={`/farmer${href}`} key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p><span className="text-xs text-muted-foreground">Abrir evidências</span></a>)}</section>
    {notice ? <p className={notice.kind === "error" ? "feedback feedback-error" : "feedback feedback-success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    <section className={styles.filters} aria-label="Filtros Farmer"><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm">Janela<select className="mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2" name="windowDays" defaultValue=""><option value="">Todas</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></label><label className="text-sm">Status<select className="mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2" name="status" defaultValue=""><option value="">Todos</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="text-sm">Risco<select className="mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2" name="riskLevel" defaultValue=""><option value="">Todos</option>{Object.entries(riskLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Ação<select className="mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2" name="action" defaultValue=""><option value="">Todas</option><option value="OVERDUE">Vencidas</option><option value="MISSING">Sem próxima ação</option><option value="EXPANSION">Expansão pendente</option><option value="REVENUE_REVIEW">Decisão de receita</option></select></label><div className="flex items-end"><Button className="w-full" type="submit" variant="secondary">Aplicar filtros</Button></div></form></section>
    {screen.items.length === 0 ? <EmptyState title="Nenhuma ação Farmer neste recorte" description="As renovações e oportunidades de expansão aparecerão aqui." /> : <div className={styles.columns}>
      <section aria-label="Fila priorizada Farmer" className={styles.queue}><div className={styles.toolbar}><h2>Renovações <span>{screen.items.length}</span></h2></div>{screen.items.map(item => <article className={styles.card} key={item.id}><header className="flex flex-wrap items-start justify-between gap-3"><div className={styles.profile}><span aria-hidden="true" className={styles.avatar}>{item.accountName.slice(0,2).toUpperCase()}</span><div><p className="text-xs text-muted-foreground">Prioridade {item.priorityRank} · {item.priorityReason}</p><h2 className="text-lg font-semibold">{item.accountName}</h2><p className="text-sm text-muted-foreground">{item.subscription?.productNameSnapshot ?? "Produto sem evidência"} · {item.ownerName}</p></div></div><div className="flex flex-wrap gap-2"><StatusBadge tone={tone[item.riskLevel]}>{item.riskLevel === "NONE" ? riskLabels.NONE : `Risco ${riskLabels[item.riskLevel].toLowerCase()}`}</StatusBadge><StatusBadge tone={item.status === "RENEWED" ? "success" : item.status === "NOT_RENEWED" ? "danger" : "info"}>{labels[item.status]}</StatusBadge></div></header><dl className={styles.facts}><div><dt className="text-xs text-muted-foreground">Data alvo</dt><dd className="font-medium tabular-nums">{date(item.targetDate, screen.timeZone)}</dd></div><div><dt className="text-xs text-muted-foreground">MRR em jogo</dt><dd className="font-medium tabular-nums">{money(item.baseMrrCents)}</dd></div><div><dt className="text-xs text-muted-foreground">Próxima ação</dt><dd className="font-medium">{item.nextActionDescription ?? "Requer correção"}<small className="block text-muted-foreground">{date(item.nextActionAt, screen.timeZone)}</small></dd></div></dl><div className={styles.actions}><Button disabled={pending} onClick={() => load(item)} size="sm" variant="secondary">Ver histórico</Button>{screen.permissions.write && !terminalStatus(item.status) ? <><Button disabled={pending} onClick={() => risk(item)} size="sm" variant="secondary">Registrar risco</Button>{screen.permissions.expansion ? <Button disabled={pending} onClick={() => addSignal(item)} size="sm" variant="secondary">Sinal de expansão</Button> : null}</> : null}{screen.permissions.confirm && !terminalStatus(item.status) ? <><Button disabled={pending} onClick={() => decide(item, "RENEW")} size="sm">Confirmar renovação</Button><Button disabled={pending} onClick={() => defer(item)} size="sm" variant="secondary">Adiar</Button><Button disabled={pending} onClick={() => decide(item, "NOT_RENEW")} size="sm" variant="secondary">Não renovar</Button><Button disabled={pending} onClick={() => decide(item, "CANCEL")} size="sm" variant="ghost">Cancelar revisão</Button></> : null}{screen.permissions.confirm && terminalStatus(item.status) ? <Button disabled={pending} onClick={() => reopen(item)} size="sm" variant="secondary">Reabrir</Button> : null}{screen.permissions.revenue && item.subscription?.status !== "CHURNED" ? <><Button disabled={pending} onClick={() => revenue(item, "CONTRACTION")} size="sm" variant="secondary">Confirmar contração</Button><Button disabled={pending} onClick={() => revenue(item, "CHURN")} size="sm" variant="destructive">Confirmar churn</Button></> : null}</div></article>)}</section>
      <aside className={styles.detail} aria-label="Detalhes Farmer">{detail ? <><h2 className="font-semibold">Histórico e evidências</h2><p className="mt-1 text-sm text-muted-foreground">Acompanhe os sinais observados e as decisões sobre este cliente.</p><details className="mt-4" open><summary className="cursor-pointer font-medium">Histórico ({detail.data.events.length})</summary><ol className="mt-2 space-y-2">{detail.data.events.map(event => <li className="border-l-2 pl-3 text-sm" key={event.id}><strong>{event.type}</strong><span className="block text-muted-foreground">{event.reason}</span></li>)}</ol></details><details className="mt-4"><summary className="cursor-pointer font-medium">Sinais ({detail.data.signals.length})</summary>{detail.data.signals.map(signal => <div className="mt-3 border-l-2 pl-3 text-sm" key={signal.id}><strong>{signal.type} · {signal.status}</strong><span className="block text-muted-foreground">{signal.evidence}</span>{signal.status === "PENDING_REVIEW" && screen.permissions.expansionConfirm ? <div className="mt-2 flex flex-wrap gap-2"><Button disabled={pending} onClick={() => reviewSignal(signal, "CONFIRM_AND_LINK")} size="sm">Confirmar e criar oportunidade</Button><Button disabled={pending} onClick={() => reviewSignal(signal, "REJECT")} size="sm" variant="secondary">Rejeitar</Button></div> : null}</div>)}</details><details className="mt-4"><summary className="cursor-pointer font-medium">Decisões de receita ({detail.data.decisions.length})</summary>{detail.data.decisions.map(decision => <div className="mt-3 text-sm" key={decision.id}><strong>{decision.type} · {decision.status}</strong><span className="block tabular-nums text-muted-foreground">{money(decision.deltaMrrCents)}</span>{decision.status === "CONFIRMED" && screen.permissions.correct ? <Button className="mt-2" disabled={pending} onClick={() => correctDecision(decision)} size="sm" variant="secondary">Corrigir por reversão</Button> : null}</div>)}</details><details className="mt-4"><summary className="cursor-pointer font-medium">Movimentos de receita ({detail.data.ledger.length})</summary>{detail.data.ledger.map(movement => <p className="mt-2 text-sm tabular-nums" key={movement.id}>{movement.type}: {money(movement.deltaMrrCents)}</p>)}</details></> : <p className="text-sm text-muted-foreground">Abra uma renovação para consultar timeline, sinais, decisões e movimentos relacionados.</p>}</aside>
    </div>}
    <details className={styles.definitions}><summary>Atualização e critérios dos indicadores</summary><p>Atualizado em {date(screen.generatedAt, screen.timeZone)}. Prioridade: {screen.formulas.priority}. Taxa: {screen.formulas.renewalRate}.</p></details>
  {actionDialog.dialog}
 </div>;
}
