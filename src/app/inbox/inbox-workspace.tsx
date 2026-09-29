"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";

type InboxScreen = Awaited<ReturnType<ReturnType<typeof getOmnichannelService>["getInbox"]>>;

const views = [
  ["ALL", "Todas"],
  ["MINE", "Minhas"],
  ["UNREAD", "Não lidas"],
  ["OVERDUE", "SLA vencido"],
  ["WAITING_INTERNAL", "Aguardando time"],
  ["WAITING_CUSTOMER", "Aguardando contato"],
] as const;

const channelLabels: Record<string, string> = {
  INTERNAL_SIMULATOR: "Simulador",
  INTERNAL: "Interno legado",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  SMS: "SMS",
  INSTAGRAM: "Instagram legado",
  INSTAGRAM_MESSAGING: "Instagram",
};

const statusLabels: Record<string, string> = {
  OPEN: "Aberta",
  PENDING_INTERNAL: "Aguardando time",
  WAITING_CUSTOMER: "Aguardando contato",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
  ARCHIVED: "Arquivada",
  RECEIVED: "Recebida",
  QUEUED: "Na fila",
  ACCEPTED_INTERNAL: "Aceita internamente",
  PROVIDER_ACCEPTED: "Aceita pelo provider",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  REPLIED: "Respondida",
  DEFERRED: "Adiada pelo provider",
  SOFT_BOUNCE: "Bounce temporário",
  HARD_BOUNCE: "Bounce permanente",
  COMPLAINT: "Denúncia",
  REJECTED: "Rejeitada",
  UNSUBSCRIBED: "Descadastrada",
  UNKNOWN_REVIEW: "Requer revisão",
  FAILED_TRANSIENT: "Falha temporária",
  FAILED_PERMANENT: "Falha permanente",
  BOUNCED: "Devolvida",
  BLOCKED_BY_POLICY: "Bloqueada por privacidade",
  CANCELLED: "Cancelada",
};

function toneFor(value: string): StatusTone {
  if (["DELIVERED", "READ", "REPLIED", "RESOLVED"].includes(value)) return "success";
  if (["FAILED_PERMANENT", "BOUNCED", "HARD_BOUNCE", "COMPLAINT", "REJECTED", "UNSUBSCRIBED", "BLOCKED_BY_POLICY", "CANCELLED"].includes(value)) return "danger";
  if (["FAILED_TRANSIENT", "DEFERRED", "SOFT_BOUNCE", "UNKNOWN_REVIEW", "PENDING_INTERNAL"].includes(value)) return "warning";
  return "info";
}

function formatDate(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function elapsedLabel(seconds: number | null) {
  if (seconds === null) return "SLA pausado";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

async function postAction(action: string, data: unknown) {
  const response = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a ação.");
  return body.result;
}

export function InboxWorkspace({ initial }: Readonly<{ initial: InboxScreen }>) {
  const router = useRouter();
  const [screen, setScreen] = useState(initial);
  const [search, setSearch] = useState(initial.query.search);
  const [messageBody, setMessageBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selected = screen.selected;
  const selectedSummary = useMemo(() => screen.conversations.find((item) => item.id === selected?.id) ?? null, [screen.conversations, selected?.id]);
  const whatsappWindowOpen = Boolean(selected?.serviceWindowExpiresAt && new Date(selected.serviceWindowExpiresAt).getTime() >= new Date(screen.generatedAt).getTime());

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams();
    const values = { view: screen.query.view, search, conversationId: selected?.id ?? "", ...next };
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    startTransition(() => router.push(`/inbox?${params.toString()}`));
  }

  async function refresh() {
    const params = new URLSearchParams({ view: screen.query.view, search });
    if (selected?.id) params.set("conversationId", selected.id);
    const response = await fetch(`/api/inbox?${params.toString()}`, { cache: "no-store" });
    const body = await response.json() as { result?: InboxScreen; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Falha ao atualizar o inbox.");
    setScreen(body.result);
  }

  async function run(action: string, data: unknown, success: string) {
    setNotice(null);
    try {
      await postAction(action, data);
      await refresh();
      setNotice({ tone: "success", text: success });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Falha inesperada." });
    }
  }

  return (
    <div className="inbox-stack" aria-busy={isPending}>
      <section aria-label="Resumo do inbox" className="inbox-metrics">
        <button onClick={() => navigate({ view: "ALL", conversationId: null })} type="button"><span>Abertas</span><strong>{screen.metrics.open}</strong></button>
        <button onClick={() => navigate({ view: "UNREAD", conversationId: null })} type="button"><span>Não lidas</span><strong>{screen.metrics.unread}</strong></button>
        <button className="is-risk" onClick={() => navigate({ view: "OVERDUE", conversationId: null })} type="button"><span>SLA vencido</span><strong>{screen.metrics.overdue}</strong></button>
        <div><span>1ª resposta média</span><strong>{screen.metrics.firstResponseAverageSeconds === null ? "—" : elapsedLabel(Math.round(screen.metrics.firstResponseAverageSeconds))}</strong></div>
      </section>

      <section className="inbox-toolbar" aria-label="Filtros do inbox">
        <form onSubmit={(event) => { event.preventDefault(); navigate({ search, conversationId: null }); }} role="search">
          <label className="sr-only" htmlFor="inbox-search">Buscar conversa</label>
          <input id="inbox-search" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contato, conta ou assunto" value={search} />
          <Button size="sm" type="submit" variant="secondary">Buscar</Button>
        </form>
        <div className="inbox-view-tabs" role="tablist" aria-label="Visões do inbox">
          {views.map(([value, label]) => <button aria-selected={screen.query.view === value} key={value} onClick={() => navigate({ view: value, conversationId: null })} role="tab" type="button">{label}</button>)}
        </div>
        {screen.capabilities.replay ? <Button onClick={() => setSimulatorOpen((open) => !open)} size="sm" type="button">{simulatorOpen ? "Fechar simulador" : "Simular entrada"}</Button> : null}
      </section>

      {simulatorOpen ? <LocalSimulator onComplete={async () => { await refresh(); setSimulatorOpen(false); }} /> : null}
      {notice ? <div className="feedback-banner" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</div> : null}

      <section className="inbox-layout">
        <div className="inbox-list" aria-label="Conversas">
          <div className="inbox-list__header"><div><h2>Conversas</h2><p>{screen.conversations.length} neste recorte</p></div><button onClick={() => void refresh()} type="button">Atualizar</button></div>
          {screen.conversations.length === 0 ? <EmptyState title="Nenhuma conversa neste recorte" description="Altere a visão ou simule uma entrada local autorizada." /> : screen.conversations.map((item) => (
            <button aria-current={item.id === selected?.id ? "true" : undefined} className="inbox-conversation-row" key={item.id} onClick={() => navigate({ conversationId: item.id })} type="button">
              <span className="inbox-conversation-row__top"><strong>{item.contactName}</strong><time>{formatDate(item.lastMessageAt)}</time></span>
              <span className="inbox-conversation-row__meta"><span>{channelLabels[item.channel] ?? item.channel}</span><StatusBadge tone={toneFor(item.status)}>{statusLabels[item.status] ?? item.status}</StatusBadge>{item.unreadCount > 0 ? <b aria-label={`${item.unreadCount} mensagens não lidas`}>{item.unreadCount}</b> : null}</span>
              <span className="inbox-conversation-row__preview">{item.preview?.body ?? "Sem prévia disponível"}</span>
              <span className="inbox-conversation-row__owner">{item.assignee?.name ?? item.queue?.name ?? "Responsabilidade inválida"}{item.needsIdentityReview ? " · revisar identidade" : ""}</span>
            </button>
          ))}
        </div>

        <article className="inbox-thread" aria-label="Detalhe da conversa">
          {!selected ? <EmptyState title="Selecione uma conversa" description="O histórico cronológico aparecerá aqui." /> : <>
            <header className="inbox-thread__header">
              <div><p>{channelLabels[selected.channel] ?? selected.channel}</p><h2>{selectedSummary?.contactName ?? "Contato não identificado"}</h2><span>{selectedSummary?.assignee?.name ?? selectedSummary?.queue?.name ?? "Sem responsável"}</span></div>
              <div className="inbox-thread__actions">
                {selected.leadId ? <Button asChild size="sm" variant="secondary"><Link href={`/leads/${selected.leadId}/historico`}>Abrir Lead 360</Link></Button> : null}
                {screen.capabilities.assign && !selected.assigneeMemberId ? <Button onClick={() => void run("COMMAND", { action: "CLAIM", conversationId: selected.id, reason: "Conversa assumida pelo operador no inbox.", expectedRevision: selected.revision }, "Conversa assumida.")} size="sm" type="button">Assumir</Button> : null}
                {screen.capabilities.manage && !["RESOLVED", "ARCHIVED"].includes(selected.status) ? <Button onClick={() => void run("COMMAND", { action: "RESOLVE", conversationId: selected.id, reason: "Atendimento resolvido pelo operador.", expectedRevision: selected.revision }, "Conversa resolvida.")} size="sm" type="button" variant="secondary">Resolver</Button> : null}
              </div>
            </header>
            {selectedSummary?.sla.state !== "NOT_RUNNING" ? <div className="inbox-sla" data-overdue={selectedSummary?.sla.state === "OVERDUE"}><span>SLA de resposta do time</span><strong>{elapsedLabel(selectedSummary?.sla.elapsedSeconds ?? null)}</strong><small>Meta operacional: até 3 minutos</small></div> : null}
            {selected.channel === "WHATSAPP" ? <div className="inbox-sla" data-overdue={!whatsappWindowOpen}><span>Janela WhatsApp de 24 horas</span><strong>{whatsappWindowOpen ? "Aberta" : "Fechada"}</strong><small>{selected.serviceWindowExpiresAt ? `Até ${formatDate(selected.serviceWindowExpiresAt)}` : "Sem entrada do contato registrada"} · template local não equivale a aprovado</small></div> : null}
            <div className="inbox-messages" aria-live="polite">
              {selected.messages.length === 0 ? <EmptyState title="Ainda não há mensagens" description="A conversa existe, mas nenhum fato de mensagem foi registrado." /> : selected.messages.map((message) => (
                <section className="inbox-message" data-direction={message.direction} key={message.id}>
                  <div className="inbox-message__meta"><span>{message.direction === "INBOUND" ? "Contato" : "Equipe"}{message.isSimulated ? " · Local" : " · Externo"}</span><time>{formatDate(message.occurredAt)}</time></div>
                  {message.subject ? <strong>{message.subject}</strong> : null}
                  <p>{message.body ?? "Conteúdo redigido pela política de retenção."}</p>
                  {message.email ? <details><summary>Threading e destinatários</summary><p className="font-mono text-xs">Message-ID: {message.email.messageId}</p><p className="text-xs">{message.email.recipients.map((recipient) => `${recipient.type}: ${recipient.address}`).join(" · ")}</p></details> : null}
                  <div className="inbox-message__status"><StatusBadge tone={toneFor(message.status)}>{statusLabels[message.status] ?? message.status}</StatusBadge>{message.isSimulated ? <span>Simulação local</span> : null}</div>
                </section>
              ))}
            </div>
            {screen.capabilities.compose ? <form className="inbox-composer" onSubmit={(event) => { event.preventDefault(); if (!messageBody.trim()) return; void run("COMPOSE_AND_ENQUEUE", { conversationId: selected.id, body: messageBody, subject: selected.channel === "EMAIL" ? emailSubject : null, templateVersionId: templateVersionId || null, idempotencyKey: `ui:${crypto.randomUUID()}`, clientCorrelationId: `ui:${crypto.randomUUID()}` }, "Mensagem avaliada e registrada.").then(() => { setMessageBody(""); setEmailSubject(""); }); }}>
              <label htmlFor="message-body">Responder</label>
              {selected.channel === "EMAIL" ? <><input aria-label="Assunto do e-mail" maxLength={240} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Assunto" required value={emailSubject} /><select aria-label="Template de e-mail" onChange={(event) => setTemplateVersionId(event.target.value)} value={templateVersionId}><option value="">Texto livre</option>{screen.options.templates.filter((item) => item.channel === "EMAIL" && item.version).map((item) => <option key={item.version!.id} value={item.version!.id}>{item.name} · v{item.version!.version}</option>)}</select></> : null}
              <textarea id="message-body" maxLength={10000} onChange={(event) => setMessageBody(event.target.value)} placeholder="Escreva uma resposta. A privacidade será reavaliada antes de enfileirar." rows={3} value={messageBody} />
              <div><small>{selected.channel === "WHATSAPP" ? "Envio livre exige janela de 24h aberta; entrega permanece local e simulada." : "Nesta fase, toda entrega é local e explicitamente simulada."}</small><Button disabled={!messageBody.trim()} type="submit">Avaliar e enfileirar</Button></div>
            </form> : null}
          </>}
        </article>

        <aside className="inbox-context" aria-label="Contexto operacional">
          <section><h2>Responsabilidade</h2><p>{selectedSummary?.assignee?.name ?? selectedSummary?.queue?.name ?? "Selecione uma conversa"}</p><small>Assumir uma conversa não altera silenciosamente o responsável do lead.</small></section>
          <section><h2>Saúde da fila</h2><dl><div><dt>Aguardando contato</dt><dd>{screen.metrics.waitingCustomer}</dd></div><div><dt>Revisões de identidade</dt><dd>{screen.metrics.identityReview}</dd></div><div><dt>Entradas</dt><dd>{screen.metrics.inboundMessages}</dd></div><div><dt>Saídas</dt><dd>{screen.metrics.outboundMessages}</dd></div></dl></section>
          <section><h2>Canais</h2><ul>{screen.capabilityMatrix.map((item) => <li key={item.channel}><span>{item.label}</span><small>{item.support === "LOCAL_ONLY" ? "Disponível localmente" : item.support === "EXTERNAL_DEFERRED" ? "Contrato pronto; integração futura" : "Preparado para o futuro"}</small></li>)}</ul></section>
        </aside>
      </section>
    </div>
  );
}

function LocalSimulator({ onComplete }: Readonly<{ onComplete: () => Promise<void> }>) {
  const [address, setAddress] = useState("+5511999990001");
  const [body, setBody] = useState("Olá, quero conversar sobre a solução.");
  const [scenario, setScenario] = useState("RECEIVED");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return <section className="surface-panel inbox-simulator"><div><h2>Simulador local de entrada</h2><p>Nenhum dado sai deste ambiente. Contatos não reconhecidos vão para revisão e Fila Geral.</p></div><form onSubmit={(event) => { event.preventDefault(); setPending(true); setError(null); void postAction("RECEIVE_LOCAL", { externalEventId: `ui:${crypto.randomUUID()}`, channel: "INTERNAL_SIMULATOR", address, body, occurredAt: new Date().toISOString(), scenario }).then(onComplete).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Falha na simulação.")).finally(() => setPending(false)); }}><label>Telefone<input onChange={(event) => setAddress(event.target.value)} value={address} /></label><label>Cenário<select onChange={(event) => setScenario(event.target.value)} value={scenario}><option value="RECEIVED">Recebida</option><option value="REPLY">Resposta</option><option value="OPT_OUT">Opt-out</option></select></label><label className="inbox-simulator__body">Mensagem<textarea onChange={(event) => setBody(event.target.value)} rows={2} value={body} /></label><Button disabled={pending} type="submit">{pending ? "Processando…" : "Registrar entrada"}</Button></form>{error ? <p role="alert">{error}</p> : null}</section>;
}
