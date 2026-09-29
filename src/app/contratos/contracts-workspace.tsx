"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ContractScreen, ContractScreenItem } from "@/modules/contracts/domain/contract-shared-contracts";

const inputClass = "mt-1 w-full rounded-[var(--radius-control)] border bg-background px-3 py-2 text-sm";
const statusLabels: Record<ContractScreenItem["status"], string> = {
  DRAFT: "Rascunho", INTERNAL_REVIEW: "Revisão interna", READY_TO_SEND: "Pronto para envio",
  SENT_SIMULATED: "Enviado (simulado)", ACCEPTED: "Aceito localmente", REJECTED: "Rejeitado",
  VOIDED: "Anulado", SUPERSEDED: "Substituído", EXPIRED: "Expirado",
};

function money(cents: string) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100); }
function key(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
async function assertOk(response: Response) { const body = await response.json().catch(() => ({})) as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a operação."); }

export function ContractsWorkspace({ screen }: Readonly<{ screen: ContractScreen }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function run(operation: () => Promise<Response>, success: string) {
    setPending(true); setNotice(null);
    try { await assertOk(await operation()); setNotice({ kind: "success", message: success }); router.refresh(); }
    catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." }); }
    finally { setPending(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const opportunity = screen.eligibleOpportunities.find((item) => item.id === form.get("opportunityId"));
    if (!opportunity) return;
    await run(() => fetch("/api/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      opportunityId: opportunity.id, offerId: opportunity.offerId, templateVersionId: String(form.get("templateVersionId")),
      billingFrequency: String(form.get("billingFrequency")), durationMonths: form.get("durationMonths") ? Number(form.get("durationMonths")) : null,
      paymentTerms: String(form.get("paymentTerms")), commercialNotes: String(form.get("commercialNotes") || "") || null,
      renewalExpected: form.get("renewalExpected") === "on", idempotencyKey: key("contract-create"),
    }) }), "Contrato criado em rascunho com snapshot da oportunidade e da oferta.");
  }

  async function act(contract: ContractScreenItem, action: string, extra: Record<string, unknown> = {}) {
    await run(() => fetch(`/api/contracts/${contract.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedRevision: contract.revision, idempotencyKey: key(`contract-${action.toLowerCase()}`), confirmed: true, ...extra }) }), "Contrato atualizado com evento e auditoria.");
  }

  async function accept(event: FormEvent<HTMLFormElement>, contract: ContractScreenItem) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const start = String(form.get("effectiveStartsAt")); const end = String(form.get("effectiveEndsAt"));
    await act(contract, "ACCEPT_LOCAL", { acceptedByName: String(form.get("acceptedByName")), acceptedByRole: String(form.get("acceptedByRole")), evidenceText: String(form.get("evidenceText")), effectiveStartsAt: new Date(`${start}T12:00:00-03:00`).toISOString(), effectiveEndsAt: end ? new Date(`${end}T12:00:00-03:00`).toISOString() : null });
  }

  const metrics = [["Rascunhos", screen.metrics.drafts], ["Aguardando aceite", screen.metrics.awaitingAcceptance], ["Aceitos", screen.metrics.accepted], ["Vencem em 30 dias", screen.metrics.expiringSoon], ["Divergências", screen.metrics.divergences]] as const;
  return <div className="space-y-5">
    <section aria-label="Indicadores contratuais" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value]) => <article className="surface-panel p-4" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></article>)}</section>
    <form className="surface-panel flex flex-wrap items-end gap-3 p-4" method="get"><label className="min-w-64 flex-1 text-sm">Buscar contrato<input className={inputClass} defaultValue={screen.filters.search} name="search" placeholder="Número do contrato" /></label><label className="min-w-48 text-sm">Status<select className={inputClass} defaultValue={screen.filters.status} name="status"><option value="ALL">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="submit">Filtrar</Button><Button asChild type="button" variant="secondary"><Link href="/contratos">Limpar</Link></Button></form>
    {notice ? <p className={notice.kind === "error" ? "feedback feedback-error" : "feedback feedback-success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    {screen.canCreate ? <details className="surface-panel p-4"><summary className="cursor-pointer font-semibold">Novo contrato a partir de oportunidade elegível</summary>{screen.eligibleOpportunities.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma oportunidade com conta, contato e oferta está disponível neste escopo.</p> : <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={create}>
      <label className="text-sm">Oportunidade<select className={inputClass} name="opportunityId" required><option value="">Selecione</option>{screen.eligibleOpportunities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.accountName} · {money(item.totalCents)}</option>)}</select></label>
      <label className="text-sm">Template<select className={inputClass} name="templateVersionId" required><option value="">Selecione</option>{screen.templateVersions.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.version} · revisão jurídica: {item.legalReviewState}</option>)}</select></label>
      <label className="text-sm">Periodicidade<select className={inputClass} name="billingFrequency"><option value="ONE_TIME">Pagamento único</option><option value="MONTHLY">Mensal</option><option value="QUARTERLY">Trimestral</option><option value="ANNUAL">Anual</option><option value="CUSTOM">Personalizada</option></select></label>
      <label className="text-sm">Duração em meses<input className={inputClass} min="1" max="240" name="durationMonths" type="number" /></label>
      <label className="text-sm md:col-span-2">Condições de pagamento<textarea className={inputClass} defaultValue="Conforme oferta comercial aprovada." name="paymentTerms" required /></label>
      <label className="text-sm md:col-span-2">Notas comerciais<textarea className={inputClass} name="commercialNotes" /></label><label className="flex items-center gap-2 text-sm"><input name="renewalExpected" type="checkbox" /> Renovação esperada</label><div className="md:col-span-2"><Button disabled={pending} type="submit">Criar rascunho</Button></div>
    </form>}</details> : null}
    {screen.items.length === 0 ? <EmptyState title="Nenhum contrato neste recorte" description="Crie um contrato somente a partir de uma oportunidade elegível; o sistema não inventa contratos históricos." /> : <section className="grid gap-4 xl:grid-cols-2">{screen.items.map((contract) => <ContractCard accept={accept} act={act} contract={contract} key={contract.id} pending={pending} />)}</section>}
  </div>;
}

function ContractCard({ contract, pending, act, accept }: Readonly<{ contract: ContractScreenItem; pending: boolean; act(contract: ContractScreenItem, action: string, extra?: Record<string, unknown>): Promise<void>; accept(event: FormEvent<HTMLFormElement>, contract: ContractScreenItem): Promise<void> }>) {
  const tone = contract.status === "ACCEPTED" ? "success" : contract.status === "REJECTED" || contract.status === "VOIDED" ? "danger" : contract.status === "SENT_SIMULATED" ? "warning" : "info";
  function runSensitive(action: "REJECT" | "VOID" | "CREATE_VERSION", label: string) {
    const reason = window.prompt(`${label}: informe o motivo (mínimo de 5 caracteres).`);
    if (!reason || reason.trim().length < 5) return;
    if (!window.confirm(`${label}? A decisão será registrada na timeline e na auditoria.`)) return;
    void act(contract, action, { reason: reason.trim() });
  }
  return <article className="surface-panel p-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{contract.contractNumber} · v{contract.currentVersion?.versionNumber ?? "—"}</p><h2 className="mt-1 text-lg font-semibold">{contract.accountName}</h2><p className="text-sm text-muted-foreground">{contract.opportunityName} · {contract.contactName}</p></div><StatusBadge tone={tone}>{statusLabels[contract.status]}</StatusBadge></header>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Responsável</dt><dd>{contract.ownerName}</dd></div><div><dt className="text-muted-foreground">Valor</dt><dd className="font-semibold tabular-nums">{contract.currentVersion ? money(contract.currentVersion.totalCents) : "Ausente"}</dd></div><div><dt className="text-muted-foreground">Versões</dt><dd>{contract.versionCount}</dd></div><div><dt className="text-muted-foreground">Integridade</dt><dd>{contract.currentVersion?.contentHash ? "Hash registrado" : "Ainda não emitido"}</dd></div></dl>
    {contract.reconciliation.length ? <ul className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950">{contract.reconciliation.map((item) => <li key={item}>Atenção: {item}</li>)}</ul> : null}
    <div className="mt-4 flex flex-wrap gap-2">{contract.status === "DRAFT" ? <Button disabled={pending} onClick={() => act(contract, "REQUEST_REVIEW", { reason: "Rascunho preparado para revisão interna" })} size="sm">Enviar para revisão</Button> : null}{contract.status === "INTERNAL_REVIEW" ? <Button disabled={pending} onClick={() => act(contract, "MARK_READY")} size="sm">Marcar pronto</Button> : null}{contract.status === "READY_TO_SEND" && contract.currentVersion?.state === "DRAFT" && contract.canIssue ? <Button disabled={pending} onClick={() => act(contract, "ISSUE")} size="sm">Emitir versão</Button> : null}{contract.status === "READY_TO_SEND" && contract.currentVersion?.state === "ISSUED" && contract.canSendSimulate ? <Button disabled={pending} onClick={() => act(contract, "SEND_SIMULATED")} size="sm">Registrar envio simulado</Button> : null}{contract.status === "SENT_SIMULATED" && contract.canReject ? <Button disabled={pending} onClick={() => runSensitive("REJECT", "Registrar rejeição")} size="sm" variant="secondary">Registrar rejeição</Button> : null}{contract.currentVersion?.state !== "DRAFT" && contract.canVersion ? <Button disabled={pending} onClick={() => runSensitive("CREATE_VERSION", "Criar nova versão")} size="sm" variant="secondary">Criar nova versão</Button> : null}{contract.currentVersion?.state !== "DRAFT" ? <Button asChild size="sm" variant="secondary"><Link href={`/contratos/${contract.id}/imprimir`} target="_blank">Imprimir HTML</Link></Button> : null}{contract.canVoid && contract.status !== "VOIDED" ? <Button disabled={pending} onClick={() => runSensitive("VOID", "Anular contrato")} size="sm" variant="destructive">Anular</Button> : null}</div>
    {contract.status === "SENT_SIMULATED" && contract.canAccept ? <details className="mt-4 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3"><summary className="cursor-pointer text-sm font-semibold">Registrar aceite manual local</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => accept(event, contract)}><label className="text-sm">Nome de quem aceitou<input className={inputClass} name="acceptedByName" required /></label><label className="text-sm">Papel declarado<input className={inputClass} name="acceptedByRole" required /></label><label className="text-sm sm:col-span-2">Evidência observada<textarea className={inputClass} minLength={5} name="evidenceText" required /></label><label className="text-sm">Início da vigência<input className={inputClass} name="effectiveStartsAt" required type="date" /></label><label className="text-sm">Fim opcional<input className={inputClass} name="effectiveEndsAt" type="date" /></label><p className="text-xs text-muted-foreground sm:col-span-2">Registro local e manual. Não representa assinatura eletrônica.</p><div className="sm:col-span-2"><Button disabled={pending} type="submit">Confirmar aceite local</Button></div></form></details> : null}
  </article>;
}
