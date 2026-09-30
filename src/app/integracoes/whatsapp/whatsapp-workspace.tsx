"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getWhatsAppService } from "@/modules/integrations/application/whatsapp-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getWhatsAppService>["screen"]>>;

const readinessLabels: Record<string, string> = {
  FAIL: "Reprovado",
  BLOCKED: "Bloqueado",
  NOT_TESTED: "Não testado externamente",
  VALIDATED_LOCALLY: "Validado localmente",
};

const reviewLabels: Record<string, string> = {
  UNKNOWN_EVENT: "Evento desconhecido",
  STATUS_REGRESSION: "Status fora de ordem",
  IDENTITY_AMBIGUOUS: "Identidade ambígua",
  PAYLOAD_INVALID: "Payload inválido",
  TEMPLATE_STATUS_UNKNOWN: "Status de template desconhecido",
};

function statusTone(status: string) {
  if (["VALIDATED_LOCALLY", "RESOLVED"].includes(status)) return "success";
  if (["FAIL", "DEAD_LETTER", "REJECTED", "OPEN"].includes(status)) return "danger";
  return "warning";
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem registro";
}

function operatingModeLabel(value: string | undefined) {
  if (value === "LOCAL_SIMULATOR") return "Simulador local";
  if (value === "PAUSED") return "Pausado";
  return "Externo desativado";
}

export function WhatsAppWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [address, setAddress] = useState("+5511999990001");
  const [body, setBody] = useState("Olá, quero conversar sobre a solução.");
  const [scenario, setScenario] = useState("RECEIVED");

  async function command(action: string, data: unknown) {
    setPending(action);
    setFeedback(null);
    try {
      const response = await fetch("/api/integrations/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const payload = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "A operação WhatsApp não foi concluída.");
      setFeedback({ tone: "success", text: action === "SIMULATE_INBOUND" ? "Entrada local registrada e encaminhada ao Inbox." : "Estado local atualizado e auditado." });
      router.refresh();
      return true;
    } catch (error) {
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : "A operação WhatsApp não foi concluída." });
      return false;
    } finally {
      setPending(null);
    }
  }

  const profile = initial.profile;
  const decisionIsIneligible = initial.decision.status === "INELIGIBLE";
  const approvedTemplates = initial.templates.filter((item) => item.providerStatus === "APPROVED" && item.providerTemplateId).length;

  return <div className="space-y-5">
    <Surface tone="critical">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader title={decisionIsIneligible ? "Canal externo inelegível" : "Ativação externa bloqueada"} description={decisionIsIneligible ? "A decisão formal registrada reprova o WhatsApp Business Platform para o escopo político e eleitoral da Politizai. O CRM mantém somente a fundação local, sem tráfego para a Meta." : "A decisão formal ainda não está persistida neste workspace. Nenhum tráfego externo é permitido enquanto o gate permanecer pendente."} />
        <div className="flex flex-wrap gap-2"><span className="status-badge" data-tone={decisionIsIneligible ? "danger" : "warning"}>{decisionIsIneligible ? "Inelegível" : "Decisão pendente"}</span><span className="status-badge" data-tone="warning">Sem selo de paridade</span></div>
      </div>
      <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-muted-foreground">Escopo decidido</dt><dd className="mt-1 font-semibold">{initial.decision.scope ?? "Decisão ainda sem escopo persistido"}</dd></div>
        <div><dt className="text-muted-foreground">Decisão registrada</dt><dd className="mt-1 font-semibold">{formatDate(initial.decision.decidedAt)} · {initial.decision.decidedBy ?? "Responsável não identificado"}</dd></div>
        <div><dt className="text-muted-foreground">Canal alternativo</dt><dd className="mt-1 font-semibold">{initial.decision.alternativeChannel === "EMAIL" ? "E-mail" : initial.decision.alternativeChannel === "PHONE" ? "Telefone" : "Não definido"} · {initial.decision.alternativeStatus === "PENDING_HOMOLOGATION" ? "homologação pendente" : initial.decision.alternativeStatus === "AUTHORIZED" ? "autorizado" : "não definido"}</dd>{initial.decision.alternativeDetail ? <p className="mt-1 text-xs text-muted-foreground">{initial.decision.alternativeDetail}</p> : null}</div>
        <div><dt className="text-muted-foreground">Egress e paridade</dt><dd className="mt-1 font-semibold">Bloqueado · selo não concedido</dd></div>
      </dl>
      {initial.decision.rationale ? <p className="mt-4 text-sm">{initial.decision.rationale}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {initial.decision.sourceUrl ? <a className="font-semibold text-primary underline-offset-4 hover:underline" href={initial.decision.sourceUrl} rel="noreferrer" target="_blank">Abrir política oficial</a> : null}
        <span className="text-muted-foreground">Fonte observada em {formatDate(initial.decision.sourceObservedAt)}</span>
      </div>
      {initial.decision.reviewTrigger ? <p className="mt-3 text-sm text-muted-foreground"><strong>Revisão futura:</strong> {initial.decision.reviewTrigger}</p> : null}
    </Surface>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Conversas" value={initial.metrics.conversations} hint="Canal canônico persistido" />
      <StatCard label="Janelas abertas" value={initial.windowMetrics.open} hint="Regra local de 24 horas" />
      <StatCard label="Janelas expiradas" value={initial.windowMetrics.expired} hint="Exigem template aprovado" />
      <StatCard label="Registros APPROVED" value={approvedTemplates} hint="Sem prova externa" />
      <StatCard label="Revisões abertas" value={initial.metrics.openReviews} hint="Exigem tratamento humano" />
      <StatCard label="Saídas" value={initial.metrics.outbound} hint="Locais e simuladas" />
    </div>

    {feedback ? <p className="feedback-banner" data-tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.text}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <Surface>
        <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader title="Estado operacional e kill switch" description="Os controles abaixo afetam exclusivamente o simulador local. Não existe ação de ativação externa nesta tela." /><span className="status-badge" data-tone={initial.killSwitch.engaged ? "danger" : "warning"}>{initial.killSwitch.label}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Modo</dt><dd className="font-semibold">{operatingModeLabel(profile?.operatingMode)}</dd></div>
          <div><dt className="text-muted-foreground">Egress externo</dt><dd className="font-semibold">Desativado</dd></div>
          <div><dt className="text-muted-foreground">Versão allowlisted</dt><dd className="font-semibold">{profile?.graphApiVersion ?? "v26.0"}</dd></div>
          <div><dt className="text-muted-foreground">Última entrada local</dt><dd className="font-semibold">{formatDate(profile?.lastInboundAt ?? null)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {!profile ? <Button disabled={pending !== null} onClick={() => void command("CONFIGURE_LOCAL", { displayName: "WhatsApp — simulador local", graphApiVersion: "v26.0" })}>{pending ? "Configurando…" : "Configurar fundação local"}</Button> : <Button disabled={pending !== null} onClick={() => void command(profile.operatingMode === "PAUSED" ? "RESUME" : "PAUSE", { revision: profile.revision })} variant={profile.operatingMode === "PAUSED" ? "secondary" : "destructive"}>{profile.operatingMode === "PAUSED" ? "Retomar somente simulador" : "Acionar kill switch local"}</Button>}
          <Button asChild variant="secondary"><Link href="/inbox?channels=WHATSAPP">Abrir histórico local</Link></Button>
          <Button asChild variant="secondary"><Link href="/integracoes/telefonia">Ver alternativa de telefonia</Link></Button>
        </div>
      </Surface>

      <Surface tone="subtle">
        <SectionHeader title="Janela, custo e limites" description="A regra de 24 horas é validada como contrato local. Ela não autoriza o canal nem comprova entrega externa." />
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-3"><dt>Conversas sem entrada do contato</dt><dd className="font-semibold">{initial.windowMetrics.withoutInbound}</dd></div>
          <div className="flex justify-between gap-3"><dt>Fora da janela</dt><dd className="text-right font-semibold">Somente template provider APPROVED</dd></div>
          <div className="flex justify-between gap-3"><dt>Rate limit</dt><dd className="text-right font-semibold">{initial.economics.rateLimit.valuePerMinute === null ? "Não mensurado — canal vedado" : `${initial.economics.rateLimit.valuePerMinute}/min`}</dd></div>
          <div className="flex justify-between gap-3"><dt>Custo provider</dt><dd className="text-right font-semibold">{initial.economics.cost.amountMicros === null ? "Não mensurado — canal vedado" : `${initial.economics.cost.currency ?? ""} ${(initial.economics.cost.amountMicros / 1_000_000).toFixed(6)}`}</dd></div>
          <div className="flex justify-between gap-3"><dt>Opt-out</dt><dd className="text-right font-semibold">Supressão validada localmente</dd></div>
        </dl>
      </Surface>
    </div>

    <Surface tone="subtle">
      <SectionHeader title="Tenant e referências de segredo" description="A interface mostra somente presença de referências. Valores de token e segredo nunca são retornados ao navegador." />
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-muted-foreground">Access token</dt><dd className="font-semibold">{profile?.secretReferences.accessToken ? "Referência presente" : "Não configurado"}</dd></div>
        <div><dt className="text-muted-foreground">App secret</dt><dd className="font-semibold">{profile?.secretReferences.appSecret ? "Referência presente" : "Não configurado"}</dd></div>
        <div><dt className="text-muted-foreground">Verify token</dt><dd className="font-semibold">{profile?.secretReferences.verifyToken ? "Referência presente" : "Não configurado"}</dd></div>
        <div><dt className="text-muted-foreground">WABA / número de teste</dt><dd className="font-semibold">{profile?.businessAccountConfigured && profile.phoneNumberConfigured ? "IDs presentes; não homologados" : "Não configurados"}</dd></div>
      </dl>
    </Surface>

    <Surface>
      <SectionHeader title="Readiness da homologação externa" description="Cada item separa prova local de validação real. Um item local não concede elegibilidade nem selo de paridade." />
      <div className="mt-4 grid gap-3 md:grid-cols-2">{initial.readiness.map((item) => <article className="rounded-[var(--radius-control)] border border-border bg-card p-4" key={item.key}><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{item.label}</h3><span className="status-badge" data-tone={statusTone(item.status)}>{readinessLabels[item.status] ?? item.status}</span></div><p className="mt-2 text-sm text-muted-foreground">{item.detail}</p></article>)}</div>
    </Surface>

    <Surface>
      <SectionHeader title="Simular entrada WhatsApp" description="Cenário determinístico para texto, resposta e opt-out. Nenhum dado sai deste ambiente." />
      <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void command("SIMULATE_INBOUND", { externalEventId: `wa-local:${crypto.randomUUID()}`, address, body, occurredAt: new Date().toISOString(), scenario }); }}>
        <label className="space-y-1 text-sm"><span className="font-semibold">Telefone</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setAddress(event.target.value)} value={address} /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Mensagem</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" maxLength={10000} onChange={(event) => setBody(event.target.value)} value={body} /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Cenário</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setScenario(event.target.value)} value={scenario}><option value="RECEIVED">Recebida</option><option value="REPLY">Resposta</option><option value="OPT_OUT">Opt-out</option></select></label>
        <div className="md:col-span-3"><Button disabled={pending !== null || !profile || profile.operatingMode !== "LOCAL_SIMULATOR"} type="submit">{pending === "SIMULATE_INBOUND" ? "Processando…" : "Registrar entrada local"}</Button></div>
      </form>
    </Surface>

    <Surface>
      <SectionHeader title="Templates WhatsApp" description="Estado local e estado do provider permanecem separados. Nenhum template desta lista comprova aprovação externa sem ID e observação reconciliada." />
      {initial.templates.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Template</th><th>Versão</th><th>Idioma</th><th>Categoria</th><th>Estado local</th><th>Estado provider</th><th>Observado em</th></tr></thead><tbody>{initial.templates.map((template) => <tr key={template.id}><td>{template.name}<small className="block text-muted-foreground">{template.key}</small></td><td>v{template.currentVersion}</td><td>{template.locale}</td><td>{template.category}</td><td>{template.status}</td><td><span className="status-badge" data-tone={template.providerStatus === "APPROVED" && template.providerTemplateId ? "warning" : "info"}>{template.providerStatus === "LOCAL_ONLY" ? "Somente local" : template.providerStatus}</span></td><td>{formatDate(template.providerStatusObservedAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhum template WhatsApp local. Isso não autoriza mensagem iniciada pela organização.</p>}
    </Surface>

    <Surface>
      <SectionHeader title="Revisões de eventos" description="Eventos desconhecidos, regressões de status e identidade ambígua ficam separados até revisão humana." />
      {initial.reviews.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Tipo</th><th>Motivo</th><th>Estado</th><th>Criado em</th></tr></thead><tbody>{initial.reviews.map((review) => <tr key={review.id}><td>{reviewLabels[review.kind] ?? review.kind}</td><td>{review.reasonCode}</td><td><span className="status-badge" data-tone={statusTone(review.status)}>{review.status === "OPEN" ? "Aberta" : review.status === "RESOLVED" ? "Resolvida" : "Dispensada"}</span></td><td>{formatDate(review.createdAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma revisão de evento registrada.</p>}
    </Surface>

    <Surface>
      <SectionHeader title="Falhas de processamento local" description="Retries e dead letters permanecem visíveis. Reprocessar exige permissão e auditoria; não dispara envio externo." />
      {initial.webhookIssues.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Evento</th><th>Estado</th><th>Tentativas</th><th>Recebido em</th><th>Erro seguro</th><th>Ação</th></tr></thead><tbody>{initial.webhookIssues.map((issue) => <tr key={issue.id}><td>{issue.eventType}</td><td><span className="status-badge" data-tone={issue.status === "DEAD_LETTER" ? "danger" : "warning"}>{issue.status === "DEAD_LETTER" ? "Falha terminal" : issue.status === "RETRY_PENDING" ? "Nova tentativa" : "Rejeitado"}</span></td><td className="font-tabular">{issue.attempts}/{issue.maxAttempts}</td><td>{formatDate(issue.receivedAt)}</td><td>{issue.errorMessage ?? issue.errorCode ?? "Sem detalhe"}</td><td>{issue.status !== "REJECTED" ? <Button variant="secondary" disabled={pending !== null} onClick={() => { if (window.confirm("Reprocessar este evento local? A ação será auditada e não enviará dados à Meta.")) void command("REPLAY_WEBHOOK", { inboxId: issue.id, reason: "Reprocessamento manual confirmado na interface da integração." }); }}>Reprocessar</Button> : <span className="text-sm text-muted-foreground">Rejeição não reutilizável</span>}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma falha local de webhook pendente.</p>}
    </Surface>
  </div>;
}
