"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import styles from "./inbox.module.css";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";

type InboxScreen = Awaited<ReturnType<ReturnType<typeof getOmnichannelService>["getInbox"]>>;

const views = [
  ["ALL", "Todas"], ["MINE", "Minhas"], ["UNREAD", "Não lidas"], ["OVERDUE", "SLA vencido"],
  ["WAITING_INTERNAL", "Aguardando time"], ["WAITING_CUSTOMER", "Aguardando contato"],
] as const;

const channelLabels: Record<string, string> = {
  INTERNAL_SIMULATOR: "Simulador", INTERNAL: "Interno", WHATSAPP: "WhatsApp", EMAIL: "E-mail", PHONE: "Telefone", SMS: "SMS",
  INSTAGRAM: "Instagram legado", INSTAGRAM_MESSAGING: "Instagram",
};
const priorityLabels: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", URGENT: "Urgente" };
const statusLabels: Record<string, string> = {
  OPEN: "Aberta", PENDING_INTERNAL: "Aguardando time", WAITING_CUSTOMER: "Aguardando contato", RESOLVED: "Resolvida", CLOSED: "Fechada", ARCHIVED: "Arquivada",
  RECEIVED: "Recebida", QUEUED: "Na fila", ACCEPTED_INTERNAL: "Aceita internamente", PROVIDER_ACCEPTED: "Aceita pelo provider", SENT: "Enviada", DELIVERED: "Entregue", READ: "Lida", REPLIED: "Respondida",
  DEFERRED: "Adiada pelo provider", SOFT_BOUNCE: "Bounce temporário", HARD_BOUNCE: "Bounce permanente", COMPLAINT: "Denúncia", REJECTED: "Rejeitada", UNSUBSCRIBED: "Descadastrada", UNKNOWN_REVIEW: "Requer revisão",
  FAILED_TRANSIENT: "Falha temporária", FAILED_PERMANENT: "Falha permanente", BOUNCED: "Devolvida", BLOCKED_BY_POLICY: "Bloqueada por privacidade", CANCELLED: "Cancelada",
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
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min ${seconds % 60}s`;
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
  const [channel, setChannel] = useState(initial.query.channels[0] ?? "");
  const [priority, setPriority] = useState(initial.query.priorities[0] ?? "");
  const [status, setStatus] = useState(initial.query.statuses[0] ?? "");
  const [queueId, setQueueId] = useState(initial.query.queueId ?? "");
  const [assigneeMemberId, setAssigneeMemberId] = useState(initial.query.assigneeMemberId ?? "");
  const [business, setBusiness] = useState(initial.query.business);
  const [messageBody, setMessageBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selected = screen.selected;
  const selectedSummary = useMemo(() => screen.conversations.find((item) => item.id === selected?.id) ?? null, [screen.conversations, selected?.id]);
  const quickReplies = screen.options.templates.filter((item) => item.channel === selected?.channel && item.version && item.version.variables.length === 0);
  const whatsappWindowOpen = Boolean(selected?.serviceWindowExpiresAt && new Date(selected.serviceWindowExpiresAt).getTime() >= new Date(screen.generatedAt).getTime());

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams();
    const values = { view: screen.query.view, search, channels: channel, priorities: priority, statuses: status, queueId, assigneeMemberId, business, conversationId: selected?.id ?? "", ...next };
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    startTransition(() => router.push(`/inbox?${params.toString()}`));
  }

  async function refresh() {
    const params = new URLSearchParams({ view: screen.query.view });
    if (search) params.set("search", search);
    if (channel) params.set("channels", channel);
    if (priority) params.set("priorities", priority);
    if (status) params.set("statuses", status);
    if (queueId) params.set("queueId", queueId);
    if (assigneeMemberId) params.set("assigneeMemberId", assigneeMemberId);
    if (business !== "ALL") params.set("business", business);
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
      return true;
    } catch (error) {
      try { await refresh(); } catch { /* Mantém o erro original. */ }
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Falha inesperada." });
      return false;
    }
  }

  async function submitMessage() {
    if (!selected || !messageBody.trim()) return;
    const sent = await run("COMPOSE_AND_ENQUEUE", {
      conversationId: selected.id, body: messageBody, subject: selected.channel === "EMAIL" ? emailSubject : null,
      templateVersionId: templateVersionId || null, idempotencyKey: `ui:${crypto.randomUUID()}`,
      clientCorrelationId: `ui:${crypto.randomUUID()}`, expectedRevision: selected.revision,
    }, "Mensagem avaliada e registrada.");
    if (sent) { setMessageBody(""); setEmailSubject(""); setTemplateVersionId(""); }
  }

  async function submitTransfer() {
    if (!selected || !transferTarget || transferReason.trim().length < 3) return;
    const [kind, id] = transferTarget.split(":");
    const transferred = await run("COMMAND", {
      action: "TRANSFER", conversationId: selected.id, memberId: kind === "member" ? id : null,
      queueId: kind === "queue" ? id : null, reason: transferReason, expectedRevision: selected.revision,
    }, "Atendimento transferido com contexto preservado.");
    if (transferred) { setTransferTarget(""); setTransferReason(""); }
  }

  return (
    <div className={`${styles.workspace} inbox-stack`} aria-busy={isPending}>
      <section aria-label="Resumo do inbox" className="inbox-metrics">
        <button onClick={() => navigate({ view: "ALL", conversationId: null })} type="button"><span>Abertas</span><strong>{screen.metrics.open}</strong></button>
        <button onClick={() => navigate({ view: "UNREAD", conversationId: null })} type="button"><span>Não lidas</span><strong>{screen.metrics.unread}</strong></button>
        <button className="is-risk" onClick={() => navigate({ view: "OVERDUE", conversationId: null })} type="button"><span>SLA vencido</span><strong>{screen.metrics.overdue}</strong></button>
        <div><span>1ª resposta média</span><strong>{screen.metrics.firstResponseAverageSeconds === null ? "—" : elapsedLabel(Math.round(screen.metrics.firstResponseAverageSeconds))}</strong></div>
      </section>

      {simulatorOpen ? <LocalSimulator onComplete={async () => { await refresh(); setSimulatorOpen(false); }} /> : null}
      {notice ? <div className="feedback-banner" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</div> : null}

      <section className="inbox-layout">
        <div className="inbox-list" aria-label="Conversas">
          <section className={`${styles.filters} inbox-toolbar`} aria-label="Filtros do inbox">
            <form onSubmit={(event) => { event.preventDefault(); navigate({ search, conversationId: null }); }} role="search">
              <label className="sr-only" htmlFor="inbox-search">Buscar conversa</label>
              <input id="inbox-search" onChange={(event) => setSearch(event.target.value)} placeholder="Contato, conta, assunto ou mensagem" value={search} />
              <Button size="sm" type="submit" variant="secondary">Buscar</Button>
            </form>
            <div className={styles.selectFilters}>
              <label><span>Canal</span><select onChange={(event) => setChannel(event.target.value)} value={channel}><option value="">Todos</option>{screen.capabilityMatrix.map((item) => <option key={item.channel} value={item.channel}>{item.label}</option>)}</select></label>
              <label><span>Prioridade</span><select onChange={(event) => setPriority(event.target.value)} value={priority}><option value="">Todas</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Estado</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="">Todos</option>{["OPEN", "PENDING_INTERNAL", "WAITING_CUSTOMER", "RESOLVED", "CLOSED", "ARCHIVED"].map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
              <label><span>Fila / setor</span><select onChange={(event) => setQueueId(event.target.value)} value={queueId}><option value="">Todas</option>{screen.options.queues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span>Responsável</span><select onChange={(event) => setAssigneeMemberId(event.target.value)} value={assigneeMemberId}><option value="">Todos</option>{screen.options.members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span>Negócio</span><select onChange={(event) => setBusiness(event.target.value as typeof business)} value={business}><option value="ALL">Todos</option><option value="WITH_OPPORTUNITY">Com negócio</option><option value="WITHOUT_OPPORTUNITY">Sem negócio</option></select></label>
              <Button onClick={() => navigate({ channels: channel, priorities: priority, statuses: status, queueId, assigneeMemberId, business, conversationId: null })} size="sm" type="button" variant="secondary">Aplicar filtros</Button>
            </div>
            <div className="inbox-view-tabs" role="tablist" aria-label="Visões do inbox">
              {views.map(([value, label]) => <button aria-selected={screen.query.view === value} key={value} onClick={() => navigate({ view: value, conversationId: null })} role="tab" type="button">{label}</button>)}
            </div>
            {screen.capabilities.replay ? <Button onClick={() => setSimulatorOpen((open) => !open)} size="sm" type="button">{simulatorOpen ? "Fechar simulador" : "Simular entrada"}</Button> : null}
          </section>

          <div className="inbox-list__header"><div><h2>Conversas</h2><p>{screen.conversations.length} neste recorte</p></div><button onClick={() => void refresh()} type="button">Atualizar</button></div>
          {screen.conversations.length === 0 ? <EmptyState title="Nenhuma conversa neste recorte" description="Altere a visão ou os filtros para continuar." /> : screen.conversations.map((item) => (
            <button aria-current={item.id === selected?.id ? "true" : undefined} className="inbox-conversation-row" key={item.id} onClick={() => navigate({ conversationId: item.id })} type="button">
              <span aria-hidden="true" className={styles.avatar}>{item.contactName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span>
              <span className="inbox-conversation-row__top"><strong>{item.contactName}</strong><time>{formatDate(item.lastMessageAt)}</time></span>
              <span className="inbox-conversation-row__meta"><span>{channelLabels[item.channel] ?? item.channel}</span><StatusBadge tone={toneFor(item.status)}>{statusLabels[item.status] ?? item.status}</StatusBadge>{item.unreadCount > 0 ? <b aria-label={`${item.unreadCount} mensagens não lidas`}>{item.unreadCount}</b> : null}</span>
              <span className="inbox-conversation-row__preview">{item.preview?.body ?? "Sem prévia disponível"}</span>
              <span className="inbox-conversation-row__owner">{item.assignee?.name ?? item.queue?.name ?? "Sem responsável"}{item.needsIdentityReview ? " · revisar identidade" : ""}</span>
            </button>
          ))}
        </div>

        <article className="inbox-thread" aria-label="Detalhe da conversa">
          {!selected ? <EmptyState title="Selecione uma conversa" description="O histórico cronológico aparecerá aqui." /> : <>
            <header className="inbox-thread__header">
              <span aria-hidden="true" className={styles.avatar}>{(selectedSummary?.contactName ?? "C").split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
              <div><p>{channelLabels[selected.channel] ?? selected.channel}</p><h2>{selectedSummary?.contactName ?? "Contato não identificado"}</h2><span>{selectedSummary?.assignee?.name ?? selectedSummary?.queue?.name ?? "Sem responsável"}</span></div>
              <div className="inbox-thread__actions">
                {screen.capabilities.manage && selected.unreadCount > 0 ? <Button onClick={() => void run("COMMAND", { action: "MARK_READ", conversationId: selected.id, unread: false, expectedRevision: selected.revision }, "Conversa marcada como lida.")} size="sm" type="button" variant="ghost">Marcar lida</Button> : null}
                {screen.capabilities.assign && !selected.assigneeMemberId ? <Button onClick={() => void run("COMMAND", { action: "CLAIM", conversationId: selected.id, reason: "Conversa assumida pelo operador no inbox.", expectedRevision: selected.revision }, "Conversa assumida.")} size="sm" type="button">Assumir</Button> : null}
                {screen.capabilities.manage && !["RESOLVED", "ARCHIVED"].includes(selected.status) ? <Button onClick={() => void run("COMMAND", { action: "RESOLVE", conversationId: selected.id, reason: "Atendimento resolvido pelo operador.", expectedRevision: selected.revision }, "Conversa resolvida.")} size="sm" type="button" variant="secondary">Resolver</Button> : null}
                {screen.capabilities.manage && ["RESOLVED", "ARCHIVED"].includes(selected.status) ? <Button onClick={() => void run("COMMAND", { action: "REOPEN", conversationId: selected.id, reason: "Atendimento reaberto pelo operador.", expectedRevision: selected.revision }, "Conversa reaberta.")} size="sm" type="button" variant="secondary">Reabrir</Button> : null}
                {screen.capabilities.manage && selected.status !== "ARCHIVED" ? <Button onClick={() => void run("COMMAND", { action: "ARCHIVE", conversationId: selected.id, reason: "Atendimento arquivado pelo operador.", expectedRevision: selected.revision }, "Conversa arquivada.")} size="sm" type="button" variant="ghost">Arquivar</Button> : null}
              </div>
            </header>
            {selectedSummary?.needsIdentityReview ? <div className={styles.reviewBanner} role="status"><strong>Correspondência ambígua</strong><span>Revise a identidade antes de usar dados pessoais ou alterar o negócio.</span></div> : null}
            {selected.sla.state !== "NOT_RUNNING" ? <div className="inbox-sla" data-overdue={selected.sla.state === "OVERDUE"}><span>SLA · {selected.sla.serviceType}</span><strong>{elapsedLabel(selected.sla.elapsedSeconds)}</strong><small>Meta: {elapsedLabel(selected.sla.targetSeconds)}{selected.sla.dueAt ? ` · vence ${formatDate(selected.sla.dueAt)}` : ""}</small></div> : null}
            {selected.channel === "WHATSAPP" ? <div className="inbox-sla" data-overdue={!whatsappWindowOpen}><span>Janela WhatsApp de 24 horas</span><strong>{whatsappWindowOpen ? "Aberta" : "Fechada"}</strong><small>{selected.serviceWindowExpiresAt ? `Até ${formatDate(selected.serviceWindowExpiresAt)}` : "Sem entrada do contato registrada"} · template local não equivale a aprovado</small></div> : null}
            <div className="inbox-messages" aria-live="polite">
              {selected.messages.length === 0 ? <EmptyState title="Ainda não há mensagens" description="A conversa existe, mas nenhum fato foi registrado." /> : selected.messages.map((message) => (
                <section className="inbox-message" data-direction={message.direction} key={message.id}>
                  <div className="inbox-message__meta"><span>{message.direction === "INBOUND" ? "Contato" : message.direction === "INTERNAL" ? "Nota interna" : message.direction === "SYSTEM" ? "Sistema" : "Equipe"}{message.isSimulated ? " · Local" : message.direction === "OUTBOUND" ? " · Externo" : ""}</span><time>{formatDate(message.occurredAt)}</time></div>
                  {message.subject ? <strong>{message.subject}</strong> : null}<p>{message.body ?? "Conteúdo redigido pela política de retenção."}</p>
                  {message.attachments.length > 0 ? <ul className={styles.attachments}>{message.attachments.map((attachment) => <li key={attachment.id}><span>{attachment.fileName}</span><small>{attachment.mimeType} · {Math.ceil(attachment.sizeBytes / 1024)} KB · {attachment.scanStatus}</small></li>)}</ul> : null}
                  {message.email ? <details><summary>Threading e destinatários</summary><p className="font-mono text-xs">Message-ID: {message.email.messageId}</p><p className="text-xs">{message.email.recipients.map((recipient) => `${recipient.type}: ${recipient.address}`).join(" · ")}</p></details> : null}
                  {message.statusEvents.length > 1 ? <details><summary>Eventos de entrega ({message.statusEvents.length})</summary><ol className={styles.deliveryTimeline}>{message.statusEvents.map((event) => <li key={event.id}><StatusBadge tone={toneFor(event.status)}>{statusLabels[event.status] ?? event.status}</StatusBadge><time>{formatDate(event.providerOccurredAt ?? event.ingestedAt)}</time></li>)}</ol></details> : null}
                  {message.direction !== "INTERNAL" ? <div className="inbox-message__status"><StatusBadge tone={toneFor(message.status)}>{statusLabels[message.status] ?? message.status}</StatusBadge>{message.isSimulated ? <span>Simulação local</span> : null}</div> : null}
                </section>
              ))}
            </div>
            {screen.capabilities.compose && selected.canReply ? <form className="inbox-composer" onSubmit={(event) => { event.preventDefault(); void submitMessage(); }}>
              <label htmlFor="message-body">Responder</label>
              {quickReplies.length > 0 ? <div className={styles.quickReplies} aria-label="Respostas rápidas">{quickReplies.map((item) => <button key={item.version!.id} onClick={() => { setTemplateVersionId(item.version!.id); setMessageBody(item.version!.bodyTemplate); }} type="button">{item.name}</button>)}</div> : null}
              {selected.channel === "EMAIL" ? <><input aria-label="Assunto do e-mail" maxLength={240} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Assunto" required value={emailSubject} /><select aria-label="Template de e-mail" onChange={(event) => { const id = event.target.value; setTemplateVersionId(id); const item = quickReplies.find((candidate) => candidate.version?.id === id); if (item?.version) setMessageBody(item.version.bodyTemplate); }} value={templateVersionId}><option value="">Texto livre</option>{quickReplies.map((item) => <option key={item.version!.id} value={item.version!.id}>{item.name} · v{item.version!.version}</option>)}</select></> : null}
              <textarea id="message-body" maxLength={10000} onChange={(event) => { setMessageBody(event.target.value); if (templateVersionId) setTemplateVersionId(""); }} placeholder="Mensagem…" rows={3} value={messageBody} />
              <div><small>{selected.channel === "WHATSAPP" ? "Envio livre exige janela de 24h aberta." : "A resposta usa a conversa e o responsável atuais."}</small><Button disabled={!messageBody.trim()} type="submit">Enviar <Icon name="seta-direita" size={15} /></Button></div>
            </form> : screen.capabilities.compose ? <div className={styles.replyBlocked} role="status"><strong>Resposta bloqueada para evitar concorrência</strong><span>Assuma ou transfira o atendimento para você antes de responder.</span></div> : null}
          </>}
        </article>

        <aside className="inbox-context" aria-label="Contexto operacional">
          <section className={styles.contactContext}><span className={styles.contextLabel}>CONTATO SELECIONADO</span><h2>{selectedSummary?.contactName ?? "Nenhum contato selecionado"}</h2>{selected?.leadId ? <Link className={styles.contextLink} href={`/leads/${selected.leadId}/historico`}>Ver contato e histórico <Icon name="seta-direita" size={14} /></Link> : null}</section>
          {selected && screen.capabilities.editContext ? <ContextEditor key={`${selected.id}:${selected.revision}`} selected={selected} run={run} /> : null}
          {selected && screen.capabilities.assign ? <section><h2>Transferir atendimento</h2><p className={styles.helper}>Muda somente o atendimento e registra motivo e histórico.</p><form className={styles.stackForm} onSubmit={(event) => { event.preventDefault(); void submitTransfer(); }}><label>Destino<select onChange={(event) => setTransferTarget(event.target.value)} required value={transferTarget}><option value="">Selecione</option><optgroup label="Pessoas">{screen.options.members.map((item) => <option key={item.id} value={`member:${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="Filas e setores">{screen.options.queues.map((item) => <option key={item.id} value={`queue:${item.id}`}>{item.name}</option>)}</optgroup></select></label><label>Motivo<textarea maxLength={500} minLength={3} onChange={(event) => setTransferReason(event.target.value)} required rows={2} value={transferReason} /></label><Button disabled={!transferTarget || transferReason.trim().length < 3} size="sm" type="submit" variant="secondary">Transferir</Button></form></section> : null}
          {selected && screen.capabilities.addNote ? <section><h2>Nota interna</h2><form className={styles.stackForm} onSubmit={(event) => { event.preventDefault(); void run("ADD_INTERNAL_NOTE", { conversationId: selected.id, body: noteBody, expectedRevision: selected.revision }, "Nota adicionada à timeline.").then((saved) => { if (saved) setNoteBody(""); }); }}><label className="sr-only" htmlFor="internal-note">Nota interna</label><textarea id="internal-note" maxLength={5000} minLength={1} onChange={(event) => setNoteBody(event.target.value)} placeholder="Contexto visível apenas para a equipe" rows={3} value={noteBody} /><Button disabled={!noteBody.trim()} size="sm" type="submit" variant="secondary">Adicionar nota</Button></form></section> : null}
          {selected?.assignments.length ? <details className={styles.auditDetails}><summary>Histórico de transferência ({selected.assignments.length})</summary><ol>{selected.assignments.map((item) => <li key={item.id}><strong>{item.previous ?? "Sem responsável"} → {item.next ?? "Sem responsável"}</strong><span>{item.reason}</span><time>{formatDate(item.occurredAt)}</time></li>)}</ol></details> : null}
          <section><h2>Saúde da fila</h2><dl><div><dt>Aguardando contato</dt><dd>{screen.metrics.waitingCustomer}</dd></div><div><dt>Revisões de identidade</dt><dd>{screen.metrics.identityReview}</dd></div><div><dt>Entradas</dt><dd>{screen.metrics.inboundMessages}</dd></div><div><dt>Saídas</dt><dd>{screen.metrics.outboundMessages}</dd></div></dl></section>
          <details className={styles.channels}><summary>Canais disponíveis</summary><ul>{screen.capabilityMatrix.map((item) => <li key={item.channel}><span>{item.label}</span><small>{item.support === "LOCAL_ONLY" ? "Disponível localmente" : item.support === "EXTERNAL_DEFERRED" ? "Contrato pronto; integração futura" : "Preparado para o futuro"}</small></li>)}</ul></details>
        </aside>
      </section>
    </div>
  );
}

function ContextEditor({ selected, run }: Readonly<{ selected: NonNullable<InboxScreen["selected"]>; run: (action: string, data: unknown, success: string) => Promise<boolean> }>) {
  const [opportunityId, setOpportunityId] = useState(selected.opportunityId ?? "");
  const [priority, setPriority] = useState(selected.priority);
  const [subject, setSubject] = useState(selected.subject ?? "");
  return <section><h2>Contexto do negócio</h2><form className={styles.stackForm} onSubmit={(event) => { event.preventDefault(); void run("UPDATE_CONTEXT", { conversationId: selected.id, opportunityId: opportunityId || null, priority, subject: subject || null, expectedRevision: selected.revision }, "Contexto comercial atualizado."); }}><label>Negócio<select onChange={(event) => setOpportunityId(event.target.value)} value={opportunityId}><option value="">Sem negócio vinculado</option>{selected.opportunities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stageName}</option>)}</select></label>{opportunityId ? <Link className={styles.contextLink} href={`/oportunidades?opportunityId=${opportunityId}`}>Abrir negócio <Icon name="seta-direita" size={14} /></Link> : null}<label>Prioridade<select onChange={(event) => setPriority(event.target.value as typeof priority)} value={priority}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Assunto<input maxLength={240} onChange={(event) => setSubject(event.target.value)} placeholder="Assunto da conversa" value={subject} /></label><Button size="sm" type="submit" variant="secondary">Salvar contexto</Button></form></section>;
}

function LocalSimulator({ onComplete }: Readonly<{ onComplete: () => Promise<void> }>) {
  const [address, setAddress] = useState("+5511999990001");
  const [body, setBody] = useState("Olá, quero conversar sobre a solução.");
  const [scenario, setScenario] = useState("RECEIVED");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return <section className="surface-panel inbox-simulator"><div><h2>Simulador local de entrada</h2><p>Nenhum dado sai deste ambiente. Contatos não reconhecidos vão para revisão e Fila Geral.</p></div><form onSubmit={(event) => { event.preventDefault(); setPending(true); setError(null); void postAction("RECEIVE_LOCAL", { externalEventId: `ui:${crypto.randomUUID()}`, channel: "INTERNAL_SIMULATOR", address, body, occurredAt: new Date().toISOString(), scenario }).then(onComplete).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Falha na simulação.")).finally(() => setPending(false)); }}><label>Telefone<input onChange={(event) => setAddress(event.target.value)} value={address} /></label><label>Cenário<select onChange={(event) => setScenario(event.target.value)} value={scenario}><option value="RECEIVED">Recebida</option><option value="REPLY">Resposta</option><option value="OPT_OUT">Opt-out</option></select></label><label className="inbox-simulator__body">Mensagem<textarea onChange={(event) => setBody(event.target.value)} rows={2} value={body} /></label><Button disabled={pending} type="submit">{pending ? "Processando…" : "Registrar entrada"}</Button></form>{error ? <p role="alert">{error}</p> : null}</section>;
}
