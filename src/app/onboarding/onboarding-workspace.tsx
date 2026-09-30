"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePostSalesActionDialog } from "@/app/onboarding/post-sales-action-dialog";
import styles from "@/app/onboarding/post-sales.module.css";

type HandoffView = Readonly<{
  id: string;
  opportunityId: string | null;
  toMemberId: string | null;
  status: "DRAFT" | "READY" | "SENT" | "REQUESTED" | "ACCEPTED" | "COMPLETED" | "REJECTED" | "CANCELLED";
  reason: string;
  revision: number;
  requestedAt: string;
}>;
type MilestoneView = Readonly<{
  id: string;
  nameSnapshot: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "SKIPPED";
  required: boolean;
  revision: number;
  dueAt: string;
  evidence: string | null;
}>;
type CaseView = Readonly<{
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "ACTIVATED" | "COMPLETED" | "CANCELLED";
  ownerMemberId: string | null;
  nextActionDescription: string;
  nextActionAt: string;
  targetAt: string;
  revision: number;
  blockingComment: string | null;
  milestones: readonly MilestoneView[];
}>;
type DeliveryPlanView = Readonly<{
  id: string;
  handoffId: string;
  transferVersionId: string;
  type: "LICENSE" | "IMPLEMENTATION" | "MANAGED_SERVICE" | "LAB_PROJECT";
  status: "DRAFT" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  title: string;
  currency: string;
  contractedValueCents: string;
  acceptedAt: string | null;
  acceptanceReason: string | null;
  checklist: readonly Readonly<{ id: string; key: string; name: string; required: boolean }>[];
}>;
type TransferVersionView = Readonly<{
  id: string;
  handoffId: string;
  version: number;
  diagnosis: unknown;
  promise: unknown;
  scope: unknown;
  approvals: unknown;
  users: unknown;
  risks: unknown;
  contractTotalCents: string;
}>;

export type OnboardingScreenView = Readonly<{
  generatedAt: string;
  timeZone: string;
  formulas: Readonly<{ overdue: string; readyToActivate: string }>;
  metrics: Readonly<{
    awaitingSend: number;
    awaitingAcceptance: number;
    inProgress: number;
    blocked: number;
    overdue: number;
    readyToActivate: number;
  }>;
  handoffs: readonly HandoffView[];
  deliveryPlans: readonly DeliveryPlanView[];
  transferVersions: readonly TransferVersionView[];
  cases: readonly CaseView[];
  members: readonly Readonly<{ id: string; name: string }>[];
  eligibleOpportunities: readonly Readonly<{
    id: string;
    name: string;
    accountName: string;
    ownerMemberId: string;
    contractNumber: string | null;
  }>[];
  permissions: Readonly<{
    manage: boolean;
    accept: boolean;
    execute: boolean;
    assign: boolean;
    correct: boolean;
  }>;
}>;

const inputClass = "mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2 text-sm";
const handoffLabels: Record<HandoffView["status"], string> = {
  DRAFT: "Rascunho",
  READY: "Pronto para envio",
  SENT: "Enviado",
  REQUESTED: "Solicitado (legado)",
  ACCEPTED: "Aceito",
  COMPLETED: "Concluído",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
};
const caseLabels: Record<CaseView["status"], string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em andamento",
  BLOCKED: "Bloqueado",
  ACTIVATED: "Cliente ativado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

function idempotency(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
async function assertOk(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a operação.");
}
function formatDate(value: string, timeZone: string) {
  return new Date(value).toLocaleString("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" });
}
function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value) / 100);
}
function planLabel(type: DeliveryPlanView["type"]) {
  return ({ LICENSE: "Licença", IMPLEMENTATION: "Implantação", MANAGED_SERVICE: "Serviço operado", LAB_PROJECT: "Projeto Lab" })[type];
}
function snapshotSummary(value: unknown) {
  if (Array.isArray(value)) return value.length === 0 ? "Nenhum registro" : `${value.length} registro(s)`;
  if (!value || typeof value !== "object") return "Não informado";
  const populated = Object.values(value).filter((item) => item !== null && item !== "" && (!Array.isArray(item) || item.length > 0)).length;
  return populated === 0 ? "Sem informação adicional" : `${populated} campo(s) transferido(s)`;
}

export function OnboardingWorkspace({ screen }: Readonly<{ screen: OnboardingScreenView }>) {
  const actionDialog = usePostSalesActionDialog();
 const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function run(operation: () => Promise<Response>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await assertOk(await operation());
      setNotice({ kind: "success", message: success });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() => fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunityId: String(form.get("opportunityId")),
        ownerMemberId: String(form.get("ownerMemberId")),
        reason: String(form.get("reason")),
        idempotencyKey: idempotency("handoff-create"),
      }),
    }), "Handoff criado em rascunho; nenhuma ativação foi inferida.");
  }
  async function actHandoff(handoff: HandoffView, action: string) {
    const reason = (await actionDialog.prompt("Motivo da alteração", "", { minLength: 8 }));
    if (!reason || reason.trim().length < 8) return;
    await run(() => fetch(`/api/onboarding/handoffs/${handoff.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expectedRevision: handoff.revision,
        reason: reason.trim(),
        idempotencyKey: idempotency(`handoff-${action.toLowerCase()}`),
      }),
    }), "Handoff atualizado com histórico e auditoria.");
  }
  async function actCase(item: CaseView, action: string, extra: Record<string, unknown> = {}) {
    const reason = (await actionDialog.prompt("Motivo da alteração", "", { minLength: 8 }));
    if (!reason || reason.trim().length < 8) return;
    await run(() => fetch(`/api/onboarding/cases/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expectedRevision: item.revision,
        reason: reason.trim(),
        idempotencyKey: idempotency(`onboarding-${action.toLowerCase()}`),
        ...extra,
      }),
    }), "Onboarding atualizado com evidência persistida.");
  }
  async function completeMilestone(item: CaseView, milestone: MilestoneView) {
    const evidence = (await actionDialog.prompt("Registre a evidência observada para concluir este marco."));
    if (!evidence || evidence.trim().length < 3) return;
    await run(() => fetch(`/api/onboarding/cases/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "COMPLETE_MILESTONE",
        expectedRevision: milestone.revision,
        milestoneId: milestone.id,
        evidence: evidence.trim(),
        reason: "Marco validado manualmente com evidência registrada.",
        idempotencyKey: idempotency("onboarding-milestone"),
      }),
    }), "Marco concluído; a ativação continua sendo uma decisão separada.");
  }

  const metrics = [
    ["Preparar envio", screen.metrics.awaitingSend],
    ["Aguardando aceite", screen.metrics.awaitingAcceptance],
    ["Em andamento", screen.metrics.inProgress],
    ["Bloqueados", screen.metrics.blocked],
    ["Atrasados", screen.metrics.overdue],
    ["Prontos para ativar", screen.metrics.readyToActivate],
  ] as const;
  return <div className={styles.workspace}>
    <section aria-label="Indicadores de onboarding" className={styles.metrics}>
      {metrics.map(([label, value]) => <article className={styles.metric} key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></article>)}
    </section>
    {notice ? <p className={notice.kind === "error" ? "feedback feedback-error" : "feedback feedback-success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    {screen.permissions.manage ? <details className={styles.create}>
      <summary className="cursor-pointer font-semibold">Criar handoff comercial</summary>
      {screen.eligibleOpportunities.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma oportunidade ganha possui, simultaneamente, conta, contrato aceito e ausência de handoff.</p> : <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={create}>
        <label className="text-sm">Oportunidade<select className={inputClass} name="opportunityId" required><option value="">Selecione</option>{screen.eligibleOpportunities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.accountName} · {item.contractNumber}</option>)}</select></label>
        <label className="text-sm">Responsável<select className={inputClass} name="ownerMemberId" required><option value="">Selecione</option>{screen.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-sm md:col-span-2">Motivo<textarea className={inputClass} defaultValue="Passagem comercial para implantação após contrato aceito." minLength={8} name="reason" required /></label>
        <div className="md:col-span-2"><Button disabled={pending} type="submit">Criar handoff</Button></div>
      </form>}
    </details> : null}
    <section className={styles.section}><h2 className="text-lg font-semibold">Passagens comerciais</h2><p className="mt-1 text-sm text-muted-foreground">Organize o envio e o aceite de cada cliente pela equipe de implantação.</p>
      {screen.handoffs.length === 0 ? <div className="mt-4"><EmptyState title="Nenhum handoff registrado" description="O histórico permanecerá vazio até uma oportunidade elegível ser enviada ao onboarding." /></div> : <div className="mt-4 table-scroll"><table><thead><tr><th>Status</th><th>Origem</th><th>Motivo</th><th>Solicitado em</th><th>Ações</th></tr></thead><tbody>{screen.handoffs.map((handoff) => <tr key={handoff.id}><td><StatusBadge tone={handoff.status === "ACCEPTED" || handoff.status === "COMPLETED" ? "success" : handoff.status === "REJECTED" || handoff.status === "CANCELLED" ? "danger" : "info"}>{handoffLabels[handoff.status]}</StatusBadge></td><td className="font-mono text-xs">{handoff.opportunityId?.slice(0, 8) ?? "Legado"}</td><td>{handoff.reason}</td><td>{formatDate(handoff.requestedAt, screen.timeZone)}</td><td><div className="flex flex-wrap gap-2">{handoff.status === "DRAFT" && screen.permissions.manage ? <Button disabled={pending} onClick={() => actHandoff(handoff, "MARK_READY")} size="sm">Marcar pronto</Button> : null}{handoff.status === "READY" && screen.permissions.manage ? <Button disabled={pending} onClick={() => actHandoff(handoff, "SEND")} size="sm">Enviar</Button> : null}{["SENT", "REQUESTED"].includes(handoff.status) && screen.permissions.accept ? <><Button disabled={pending} onClick={() => actHandoff(handoff, "ACCEPT")} size="sm">Aceitar</Button><Button disabled={pending} onClick={() => actHandoff(handoff, "REJECT")} size="sm" variant="secondary">Rejeitar</Button></> : null}</div></td></tr>)}</tbody></table></div>}
    </section>
    <section aria-labelledby="delivery-plans-heading"><div className={styles.toolbar}><div><h2 id="delivery-plans-heading">Planos de entrega <span>{screen.deliveryPlans.length}</span></h2><p>Escopo, valores e checklists gerados da versão contratual aceita.</p></div></div>
      {screen.deliveryPlans.length === 0 ? <div className="mt-4"><EmptyState title="Nenhum plano de entrega" description="Os planos serão gerados quando um handoff elegível for criado." /></div> : <div className={`${styles.cardGrid} mt-4`}>{screen.deliveryPlans.map((plan) => {
        const transfer = screen.transferVersions.find((item) => item.id === plan.transferVersionId);
        return <article className={styles.card} key={plan.id}><header className="flex flex-wrap items-start justify-between gap-3"><div><p>{planLabel(plan.type)}</p><h3>{plan.title}</h3><p>{formatMoney(plan.contractedValueCents, plan.currency)} · versão transferida {transfer?.version ?? "—"}</p></div><StatusBadge tone={plan.status === "ACCEPTED" || plan.status === "COMPLETED" ? "success" : "info"}>{plan.status === "DRAFT" ? "Aguardando aceite" : plan.status === "ACCEPTED" ? "Aceito pela entrega" : plan.status === "IN_PROGRESS" ? "Em andamento" : plan.status === "COMPLETED" ? "Concluído" : "Cancelado"}</StatusBadge></header>
          {plan.acceptedAt ? <p className="mt-3 text-xs text-muted-foreground">Aceite explícito em {formatDate(plan.acceptedAt, screen.timeZone)}. {plan.acceptanceReason}</p> : null}
          <ol aria-label={`Checklist de ${planLabel(plan.type)}`} className={styles.milestones}>{plan.checklist.map((item) => <li key={item.id}><p className="text-sm font-medium">{item.name}{item.required ? " · obrigatório" : ""}</p></li>)}</ol>
          {transfer ? <details className="mt-3"><summary>Conferir transferência comercial</summary><dl className={styles.transferFacts}><div><dt>Diagnóstico</dt><dd>{snapshotSummary(transfer.diagnosis)}</dd></div><div><dt>Promessa</dt><dd>{snapshotSummary(transfer.promise)}</dd></div><div><dt>Escopo</dt><dd>{snapshotSummary(transfer.scope)}</dd></div><div><dt>Aprovações</dt><dd>{snapshotSummary(transfer.approvals)}</dd></div><div><dt>Usuários</dt><dd>{snapshotSummary(transfer.users)}</dd></div><div><dt>Riscos</dt><dd>{snapshotSummary(transfer.risks)}</dd></div></dl></details> : null}
        </article>;
      })}</div>}
    </section>
    <section><div className={styles.toolbar}><div><h2>Onboardings ativos <span>{screen.cases.length}</span></h2><p>Acompanhe os marcos e prepare cada cliente para a ativação.</p></div></div>
      {screen.cases.length === 0 ? <div className="mt-4"><EmptyState title="Nenhum onboarding iniciado" description="Os clientes aparecerão aqui após o aceite da passagem comercial." /></div> : <div className={`${styles.cardGrid} mt-4`}>{screen.cases.map((item) => <article className={styles.card} key={item.id}><header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Próxima ação</p><h3 className="font-semibold">{item.nextActionDescription}</h3><p className="text-xs text-muted-foreground">Prazo {formatDate(item.targetAt, screen.timeZone)}</p></div><StatusBadge tone={item.status === "BLOCKED" ? "danger" : item.status === "ACTIVATED" || item.status === "COMPLETED" ? "success" : "info"}>{caseLabels[item.status]}</StatusBadge></header>{item.blockingComment ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">Bloqueio: {item.blockingComment}</p> : null}<progress aria-label="Progresso da implantação" className={styles.progress} max={item.milestones.length || 1} value={item.milestones.filter((milestone) => milestone.status === "COMPLETED").length} /><div className={styles.progressLabel}><span>Progresso da implantação</span><span>{item.milestones.filter((milestone) => milestone.status === "COMPLETED").length}/{item.milestones.length} marcos</span></div><ol className={styles.milestones}>{item.milestones.map((milestone) => <li data-completed={milestone.status === "COMPLETED"} key={milestone.id}><div><p className="text-sm font-medium">{milestone.nameSnapshot}{milestone.required ? " · obrigatório" : ""}</p><p className="text-xs text-muted-foreground">{milestone.status === "COMPLETED" ? `Evidência: ${milestone.evidence}` : `Prazo ${formatDate(milestone.dueAt, screen.timeZone)}`}</p></div>{milestone.status !== "COMPLETED" && screen.permissions.execute ? <Button disabled={pending} onClick={() => completeMilestone(item, milestone)} size="sm" variant="secondary">Concluir</Button> : <StatusBadge tone={milestone.status === "COMPLETED" ? "success" : "neutral"}>{milestone.status === "COMPLETED" ? "Concluído" : milestone.status === "BLOCKED" ? "Bloqueado" : milestone.status === "IN_PROGRESS" ? "Em andamento" : milestone.status === "SKIPPED" ? "Dispensado" : "Pendente"}</StatusBadge>}</li>)}</ol><div className={styles.actions}>{item.status === "PENDING" && screen.permissions.execute ? <Button disabled={pending} onClick={() => actCase(item, "START")} size="sm">Iniciar</Button> : null}{item.status === "IN_PROGRESS" && screen.permissions.execute ? <><Button disabled={pending} onClick={() => actCase(item, "ACTIVATE")} size="sm">Registrar ativação</Button><Button disabled={pending} onClick={() => actCase(item, "BLOCK", { reasonCode: "OPERATIONAL_BLOCK" })} size="sm" variant="secondary">Bloquear</Button></> : null}{item.status === "BLOCKED" && screen.permissions.execute ? <Button disabled={pending} onClick={() => actCase(item, "UNBLOCK")} size="sm">Retomar</Button> : null}{item.status === "ACTIVATED" && screen.permissions.execute ? <Button disabled={pending} onClick={() => actCase(item, "COMPLETE")} size="sm">Concluir onboarding</Button> : null}</div></article>)}</div>}
    </section>
    <details className={styles.definitions}><summary>Atualização e critérios dos indicadores</summary><p>Atualizado em {formatDate(screen.generatedAt, screen.timeZone)}. Atraso: {screen.formulas.overdue}. Pronto para ativar: {screen.formulas.readyToActivate}.</p></details>
  {actionDialog.dialog}
 </div>;
}
