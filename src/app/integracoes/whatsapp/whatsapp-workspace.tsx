"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getWhatsAppService } from "@/modules/integrations/application/whatsapp-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getWhatsAppService>["screen"]>>;

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem registro";
}

export function WhatsAppWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [address, setAddress] = useState("+5511999990001");
  const [body, setBody] = useState("Olá, quero conversar sobre a solução.");
  const [scenario, setScenario] = useState("RECEIVED");

  async function command(action: string, data: unknown) {
    setPending(action); setFeedback(null);
    const response = await fetch("/api/integrations/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    setPending(null);
    if (!response.ok) { setFeedback({ tone: "danger", text: payload.error?.message ?? "A operação WhatsApp não foi concluída." }); return false; }
    setFeedback({ tone: "success", text: action === "SIMULATE_INBOUND" ? "Entrada WhatsApp registrada localmente e encaminhada ao Inbox." : "Configuração local atualizada e auditada." });
    router.refresh(); return true;
  }

  const profile = initial.profile;
  return <div className="space-y-5">
    <Surface tone="critical">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader title="Ativação externa bloqueada" description="O produto pode se enquadrar na restrição da política do WhatsApp para serviços relacionados a política. É obrigatória uma revisão formal de elegibilidade antes de qualquer credencial, sandbox ou envio real." />
        <span className="status-badge" data-tone="warning">Revisão de política pendente</span>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{initial.activationBlockReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </Surface>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Conversas" value={initial.metrics.conversations} hint="Canal WhatsApp persistido" />
      <StatCard label="Entradas" value={initial.metrics.inbound} hint="Fatos canônicos" />
      <StatCard label="Saídas" value={initial.metrics.outbound} hint="Sempre identificadas como simulação" />
      <StatCard label="Webhooks pendentes" value={initial.metrics.pendingWebhooks} hint="Recebimento assíncrono" />
      <StatCard label="Revisões" value={initial.metrics.openReviews} hint="Eventos desconhecidos ou fora de ordem" />
    </div>

    {feedback ? <p className="feedback-banner" data-tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.text}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <Surface>
        <SectionHeader title="Fundação local segura" description="O simulador usa o mesmo modelo de conversa, mensagem, privacidade, owner/fila, status, job e auditoria sem acessar graph.facebook.com." />
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Modo</dt><dd className="font-semibold">{profile?.operatingMode === "LOCAL_SIMULATOR" ? "Simulador local" : profile?.operatingMode === "PAUSED" ? "Pausado" : "Não configurado"}</dd></div>
          <div><dt className="text-muted-foreground">Versão allowlisted</dt><dd className="font-semibold">{profile?.graphApiVersion ?? "v26.0"}</dd></div>
          <div><dt className="text-muted-foreground">Egress externo</dt><dd className="font-semibold">Desativado</dd></div>
          <div><dt className="text-muted-foreground">Última entrada</dt><dd className="font-semibold">{formatDate(profile?.lastInboundAt ?? null)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {!profile ? <Button disabled={pending !== null} onClick={() => void command("CONFIGURE_LOCAL", { displayName: "WhatsApp — simulador local", graphApiVersion: "v26.0" })}>{pending ? "Configurando…" : "Configurar simulador"}</Button> : <Button disabled={pending !== null} onClick={() => void command(profile.operatingMode === "PAUSED" ? "RESUME" : "PAUSE", { revision: profile.revision })} variant="secondary">{profile.operatingMode === "PAUSED" ? "Retomar simulador" : "Pausar simulador"}</Button>}
          <Button asChild variant="secondary"><Link href="/inbox?channels=WHATSAPP">Abrir conversas</Link></Button>
        </div>
      </Surface>

      <Surface tone="subtle">
        <SectionHeader title="Segredos e tenant" description="Nenhum valor secreto é armazenado ou exibido. O endpoint futuro resolve referências no servidor e exige correspondência exata do phone-number ID." />
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-3"><dt>Access token</dt><dd className="font-semibold">{profile?.secretReferences.accessToken ? "Referência presente" : "Não configurado"}</dd></div>
          <div className="flex justify-between gap-3"><dt>App secret</dt><dd className="font-semibold">{profile?.secretReferences.appSecret ? "Referência presente" : "Não configurado"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Verify token</dt><dd className="font-semibold">{profile?.secretReferences.verifyToken ? "Referência presente" : "Não configurado"}</dd></div>
          <div className="flex justify-between gap-3"><dt>WABA / número</dt><dd className="font-semibold">{profile?.businessAccountConfigured && profile.phoneNumberConfigured ? "Mapeados" : "Não configurados"}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">A chave opaca da rota não substitui assinatura. O GET exige verify token e o POST valida X-Hub-Signature-256 sobre os bytes brutos antes do parse.</p>
      </Surface>
    </div>

    <Surface>
      <SectionHeader title="Simular entrada WhatsApp" description="Cenário determinístico para texto, resposta e opt-out. Nenhum dado sai deste computador." />
      <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void command("SIMULATE_INBOUND", { externalEventId: `wa-local:${crypto.randomUUID()}`, address, body, occurredAt: new Date().toISOString(), scenario }); }}>
        <label className="space-y-1 text-sm"><span className="font-semibold">Telefone</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setAddress(event.target.value)} value={address} /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Mensagem</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" maxLength={10000} onChange={(event) => setBody(event.target.value)} value={body} /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Cenário</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setScenario(event.target.value)} value={scenario}><option value="RECEIVED">Recebida</option><option value="REPLY">Resposta</option><option value="OPT_OUT">Opt-out</option></select></label>
        <div className="md:col-span-3"><Button disabled={pending !== null || !profile || profile.operatingMode !== "LOCAL_SIMULATOR"} type="submit">{pending === "SIMULATE_INBOUND" ? "Processando…" : "Registrar entrada local"}</Button></div>
      </form>
    </Surface>

    <Surface>
      <SectionHeader title="Templates WhatsApp" description="Template criado no CRM permanece local. Somente status APPROVED confirmado pelo provider tornaria o template elegível fora da janela de 24 horas." />
      {initial.templates.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Template</th><th>Idioma</th><th>Categoria</th><th>Estado local</th><th>Estado provider</th></tr></thead><tbody>{initial.templates.map((template) => <tr key={template.id}><td>{template.name}</td><td>{template.locale}</td><td>{template.category}</td><td>{template.status}</td><td>{template.providerStatus === "LOCAL_ONLY" ? "Somente local" : template.providerStatus}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhum template WhatsApp local. Isso não autoriza mensagem iniciada pela empresa.</p>}
    </Surface>

    <Surface>
      <SectionHeader title="Falhas de processamento" description="Retries e dead-letters permanecem visíveis. Reprocessar exige permissão e cria auditoria; não dispara envio externo." />
      {initial.webhookIssues.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Evento</th><th>Estado</th><th>Tentativas</th><th>Recebido em</th><th>Erro seguro</th><th>Ação</th></tr></thead><tbody>{initial.webhookIssues.map((issue) => <tr key={issue.id}><td>{issue.eventType}</td><td><span className="status-badge" data-tone={issue.status === "DEAD_LETTER" ? "danger" : "warning"}>{issue.status === "DEAD_LETTER" ? "Falha terminal" : issue.status === "RETRY_PENDING" ? "Nova tentativa" : "Rejeitado"}</span></td><td className="font-tabular">{issue.attempts}/{issue.maxAttempts}</td><td>{formatDate(issue.receivedAt)}</td><td>{issue.errorMessage ?? issue.errorCode ?? "Sem detalhe"}</td><td>{issue.status !== "REJECTED" ? <Button variant="secondary" disabled={pending !== null} onClick={() => { if (window.confirm("Reprocessar este evento WhatsApp localmente? A ação será auditada.")) void command("REPLAY_WEBHOOK", { inboxId: issue.id, reason: "Reprocessamento manual confirmado na interface da integração." }); }}>Reprocessar</Button> : <span className="text-sm text-muted-foreground">Rejeição não reutilizável</span>}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma falha de webhook pendente.</p>}
    </Surface>
  </div>;
}
