"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableShell, SectionHeader, Surface, StatCard } from "@/components/ui/surface";
import type { getPrivacyService } from "@/modules/privacy/application/privacy-service";

type PrivacyScreen = Awaited<ReturnType<ReturnType<typeof getPrivacyService>["getScreen"]>>;
const inputClass = "h-10 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels: Record<string, string> = {
  PENDING_LEGAL: "Pendente de jurídico", DRAFT: "Rascunho", ACTIVE: "Ativa", APPROVED: "Aprovada", RETIRED: "Encerrada",
  RECEIVED: "Recebida", IDENTITY_PENDING: "Identidade pendente", IN_REVIEW: "Em análise", ACTION_REQUIRED: "Ação necessária", BLOCKED: "Bloqueada", COMPLETED: "Concluída", REJECTED: "Rejeitada", CANCELLED: "Cancelada",
  GRANTED: "Concedido", DENIED: "Negado", REVOKED: "Revogado", OPTED_OUT: "Não contatar", REVIEW_REQUIRED: "Revisão necessária", UNKNOWN: "Sem evidência",
};

function nameOf(contact: { preferredName: string | null; legalName: string | null } | null) {
  return contact?.preferredName ?? contact?.legalName ?? "Titular não identificado";
}

export function PrivacyWorkspace({ initial }: Readonly<{ initial: PrivacyScreen }>) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createDsr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setFeedback(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/privacy/dsr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CREATE", data: { leadId: form.get("leadId"), type: form.get("type"), receivedChannel: "OTHER", categoryIds: form.getAll("categoryIds"), reason: form.get("reason") } }) });
    const body = await response.json(); setPending(false);
    if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível registrar a solicitação."); return; }
    setFeedback("Solicitação registrada com responsável explícito e auditoria."); router.refresh();
  }

  const counts = Object.fromEntries(initial.overview.states.map((item) => [item.state, item._count._all]));
  return <div className="space-y-5">
    <Surface tone="accent" className="border-blue-200">
      <SectionHeader title="Decisão conservadora por padrão" description="A configuração atual é técnica e permanece PENDING_LEGAL. Ela não representa parecer jurídico nem autoriza contato real." />
    </Surface>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Autorizações comprovadas" value={counts.GRANTED ?? 0} hint="Por finalidade, canal e ponto de contato" />
      <StatCard label="Revisão necessária" value={counts.REVIEW_REQUIRED ?? 0} hint="Sinal legado não é consentimento comprovado" />
      <StatCard label="Negativas e opt-outs" value={(counts.DENIED ?? 0) + (counts.REVOKED ?? 0) + (counts.OPTED_OUT ?? 0)} hint="Precedência restritiva" />
      <StatCard label="Solicitações abertas" value={initial.requests.filter((item) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(item.status)).length} hint={`${initial.overview.activeLegalHolds} legal holds ativos`} />
    </div>

    <Surface>
      <SectionHeader title="Finalidades e bases legais" description="Versões publicadas são imutáveis. Aprovação exige ator humano autorizado e referência jurídica externa ao sistema." />
      <DataTableShell className="mt-4"><table><thead><tr><th>Finalidade</th><th>Versão</th><th>Canais</th><th>Base legal</th><th>Status</th></tr></thead><tbody>{initial.purposes.map((purpose) => <tr key={purpose.id}><td><strong>{purpose.name}</strong><small className="block text-muted-foreground">{purpose.code}</small></td><td>{purpose.currentVersion?.version ?? "—"}</td><td>{purpose.currentVersion?.allowedChannels.join(", ") || "Nenhum"}</td><td>{purpose.currentVersion?.legalBasis?.name ?? "Não definida"}</td><td><span className="status-badge" data-tone="warning">{labels[purpose.currentVersion?.status ?? "DRAFT"]}</span></td></tr>)}</tbody></table></DataTableShell>
    </Surface>

    {initial.permissions.canManageDsr ? <Surface tone="subtle">
      <SectionHeader title="Registrar solicitação de titular" description="Use somente após identificar a pessoa. Documento bruto não deve ser copiado para este formulário." />
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={createDsr}>
        <label className="text-sm">ID do lead<input className={`${inputClass} mt-1 font-mono`} name="leadId" required /></label>
        <label className="text-sm">Tipo<select className={`${inputClass} mt-1`} name="type"><option value="ACCESS">Acesso</option><option value="CORRECTION">Correção</option><option value="PORTABILITY">Portabilidade</option><option value="OPPOSITION">Oposição</option><option value="REVOCATION">Revogação</option><option value="DELETION">Eliminação</option></select></label>
        <fieldset className="md:col-span-2"><legend className="text-sm font-semibold">Categorias</legend><div className="mt-2 flex flex-wrap gap-3">{initial.categories.map((category) => <label className="flex items-center gap-2 text-sm" key={category.id}><input name="categoryIds" type="checkbox" value={category.id} />{category.name}</label>)}</div></fieldset>
        <label className="text-sm md:col-span-2">Motivo<textarea className="mt-1 min-h-20 w-full rounded-[var(--radius-control)] border border-border bg-card p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" name="reason" required /></label>
        <div className="md:col-span-2"><Button disabled={pending} type="submit">{pending ? "Registrando…" : "Registrar solicitação"}</Button></div>
      </form>
      {feedback ? <p className="mt-3 text-sm" role="status">{feedback}</p> : null}
    </Surface> : null}

    <div className="grid gap-5 xl:grid-cols-2">
      <Surface><SectionHeader title="Solicitações de titulares" description="Estados e verificação permanecem rastreáveis." />{initial.requests.length === 0 ? <div className="mt-4"><EmptyState title="Nenhuma solicitação" description="O workspace ainda não possui solicitações de titulares." /></div> : <div className="mt-4 space-y-3">{initial.requests.map((request) => <article className="rounded-[var(--radius-control)] border border-border p-3 text-sm" key={request.id}><div className="flex flex-wrap justify-between gap-2"><strong>{nameOf(request.contact)}</strong><span className="status-badge" data-tone={request.status === "BLOCKED" ? "danger" : "default"}>{labels[request.status] ?? request.status}</span></div><p className="mt-1 text-muted-foreground">{request.type} · identidade: {labels[request.verificationStatus] ?? request.verificationStatus}</p></article>)}</div>}</Surface>
      <Surface><SectionHeader title="Retenção e legal hold" description="Nenhuma eliminação destrutiva é executada com política pendente ou hold ativo." />{initial.retentionActions.length === 0 && initial.holds.length === 0 ? <div className="mt-4"><EmptyState title="Nenhuma ação pendente" description="Não há previews de retenção ou legal holds registrados." /></div> : <div className="mt-4 space-y-3">{initial.holds.map((hold) => <article className="rounded-[var(--radius-control)] border border-border p-3 text-sm" key={hold.id}><strong>Legal hold · {nameOf(hold.contact)}</strong><p className="mt-1 text-muted-foreground">{hold.reason} · {hold.status}</p></article>)}{initial.retentionActions.map((action) => <article className="rounded-[var(--radius-control)] border border-border p-3 text-sm" key={action.id}><strong>{action.action} · {labels[action.status] ?? action.status}</strong><p className="mt-1 text-muted-foreground">{action.reason}</p>{action.blockerCodes.length ? <p className="mt-1 text-amber-800">Bloqueios: {action.blockerCodes.join(", ")}</p> : null}</article>)}</div>}</Surface>
    </div>

    <Surface><SectionHeader title="Eventos recentes de consentimento" description="Histórico append-only; correções são novos eventos, nunca edição retroativa." />{initial.consentEvents.length === 0 ? <div className="mt-4"><EmptyState title="Nenhum evento" description="O backfill ainda não foi executado ou não há sinal legado explícito." /></div> : <DataTableShell className="mt-4"><table><thead><tr><th>Titular</th><th>Finalidade</th><th>Canal</th><th>Evento</th><th>Efeito</th><th>Data</th></tr></thead><tbody>{initial.consentEvents.map((event) => <tr key={event.id}><td>{nameOf(event.contact)}</td><td>{event.purposeVersion.purpose.name} v{event.purposeVersion.version}</td><td>{event.channel}</td><td>{labels[event.action] ?? event.action}</td><td>{labels[event.effect] ?? event.effect}</td><td>{new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(event.occurredAt))}</td></tr>)}</tbody></table></DataTableShell>}</Surface>
  </div>;
}
