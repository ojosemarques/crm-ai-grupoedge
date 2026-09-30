"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { copilotActionSchema, type CopilotAction, type CopilotActionOptions, type CopilotActionPreview } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import styles from "./copilot-drawer.module.css";

type SalePreview = Readonly<{
  customerName: string; sellerName: string; contractTemplateName: string; summary: string;
  customer?: { mode: "CREATE" | "LINK" | "EXISTING"; name: string };
  pendingSteps: readonly string[];
  payload: Readonly<{ totalCents: string; upfrontCents: string; monthlyCents: string; durationMonths: number; startsAt: string; acceptance?: { acceptedByName: string; acceptedByRole: string; evidenceText: string } }>;
  schedule: readonly Readonly<{ installment: number; amountCents: string; dueAt: string }>[];
}>;
type Proposal = Readonly<{ id: string; type: string; revision: number; expiresAt: string; preview: SalePreview | CopilotActionPreview; resuming?: boolean }>;
type QueryResult = Readonly<{ answer: string; proposal: Proposal | null; links: readonly Readonly<{ label: string; href: string; entityType: string }>[] }>;
type HistoryItem = Readonly<{ id: string; type: string; status: string; preview: SalePreview | CopilotActionPreview; createdAt: string; approvedAt: string | null; cancelledAt: string | null }>;
type Screen = { mode: "LOCAL" | "OPENAI"; pending: Proposal[]; history: HistoryItem[]; options: CopilotActionOptions };
type Message = Readonly<{ id: string; role: "USER" | "COPILOT"; text: string; result?: QueryResult }>;

const suggestions = ["Quais leads precisam de ação hoje?", "Quais oportunidades estão paradas?", "Como estão o caixa, as despesas e o MRR?", "Quais campanhas geraram mais vendas?"];
const labels: Record<CopilotAction["kind"] | "CLOSE_SALE", string> = { CREATE_TASK: "Criar tarefa", UPDATE_CUSTOMER: "Atualizar cliente", CREATE_EXPENSE: "Registrar despesa", RECORD_PAYMENT: "Registrar recebimento", CLOSE_SALE: "Fechar venda" };
const statusLabels: Record<string, string> = { DRAFT: "Aguardando confirmação", EXECUTING: "Confirmação em andamento", EXECUTION_FAILED: "Recuperação disponível", PUBLISHED: "Executada", CANCELLED: "Cancelada", EXPIRED: "Expirada" };
const currency = (cents: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const localDateTime = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

function moneyCents(raw: string) {
  const value = raw.trim().replace(/\s/g, "");
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Informe um valor como 150,00.");
  const [whole = "0", fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}

function PreviewDetails({ preview }: Readonly<{ preview: SalePreview | CopilotActionPreview }>) {
  if ("kind" in preview) return <>
    <strong>{preview.title}</strong><p>{preview.summary}</p>
    <dl>{preview.details.map((detail, index) => <div key={`${index}:${detail.label}`}><dt>{detail.label}</dt><dd>{detail.before !== undefined ? <><span className={styles.before}>{detail.before}</span><span aria-label="alterar para"> → </span></> : null}{detail.after}</dd></div>)}</dl>
    <ul>{preview.impact.map((impact) => <li key={impact}>{impact}</li>)}</ul>
  </>;
  return <>
    <p>{preview.summary}</p>
    <dl>
      <div><dt>Cliente</dt><dd>{preview.customerName}{preview.customer?.mode === "CREATE" ? " (novo cadastro)" : ""}</dd></div>
      <div><dt>Vendedor</dt><dd>{preview.sellerName}</dd></div>
      <div><dt>Valor total</dt><dd>{currency(preview.payload.totalCents)}</dd></div>
      <div><dt>Entrada</dt><dd>{currency(preview.payload.upfrontCents)}</dd></div>
      <div><dt>Mensalidade / prazo</dt><dd>{currency(preview.payload.monthlyCents)} × {preview.payload.durationMonths} meses</dd></div>
      <div><dt>Início</dt><dd>{date(preview.payload.startsAt)}</dd></div>
      <div><dt>Contrato</dt><dd>{preview.contractTemplateName}</dd></div>
    </dl>
    {preview.payload.acceptance ? <p><strong>Aceite informado:</strong> {preview.payload.acceptance.acceptedByName} ({preview.payload.acceptance.acceptedByRole}) — {preview.payload.acceptance.evidenceText}</p> : <p>Contrato em rascunho: aceite do cliente ainda pendente.</p>}
    <details><summary>Cronograma de cobranças</summary><ol>{preview.schedule.map((item) => <li key={item.installment}>{date(item.dueAt)} — {currency(item.amountCents)}</li>)}</ol></details>
    {preview.pendingSteps.length ? <ul>{preview.pendingSteps.map((step) => <li key={step}>{step}</li>)}</ul> : null}
  </>;
}

function ActionForm({ kind, options, busy, onPropose }: Readonly<{ kind: CopilotAction["kind"]; options: CopilotActionOptions; busy: boolean; onPropose: (action: CopilotAction) => Promise<void> }>) {
  const [customerId, setCustomerId] = useState(options.customers[0]?.id ?? "");
  const [invoiceId, setInvoiceId] = useState(options.invoices[0]?.id ?? "");
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = options.customers.find((item) => item.id === customerId);
  const invoice = options.invoices.find((item) => item.id === invoiceId);
  const optionList = (records: readonly { id: string; name: string }[]) => records.map((item) => <option key={item.id} value={item.id}>{item.name}</option>);
  const field = (name: string, label: string, props: Readonly<{ type?: string; required?: boolean; defaultValue?: string; maxLength?: number; inputMode?: "decimal" }> = {}) => <label>{label}<input name={name} {...props} /></label>;
  async function submit(form: FormData) {
    setError(null);
    try {
      const value = (key: string) => String(form.get(key) ?? "").trim();
      const iso = (key: string) => { const parsed = new Date(value(key)); if (!Number.isFinite(parsed.getTime())) throw new Error("Informe a data e a hora da ação."); return parsed.toISOString(); };
      let payload: unknown;
      if (kind === "CREATE_TASK") payload = { kind, leadId: value("leadId"), title: value("title"), description: value("description"), taskKind: value("taskKind"), priority: value("priority"), dueAt: iso("dueAt") };
      if (kind === "UPDATE_CUSTOMER") {
        if (!customer) throw new Error("Selecione um cliente.");
        const desired = { name: value("name"), legalName: value("legalName") || null, domain: value("domain") || null, segment: value("segment"), size: value("size") };
        const changes = Object.fromEntries(Object.entries(desired).filter(([key, next]) => next !== customer[key as keyof typeof desired]));
        if (!Object.keys(changes).length) throw new Error("Altere pelo menos um campo do cliente.");
        payload = { kind, accountId: customer.id, expectedRevision: customer.revision, changes };
      }
      if (kind === "CREATE_EXPENSE") payload = { kind, description: value("description"), categoryId: value("categoryId"), financialAccountId: value("financialAccountId"), ...(value("customerAccountId") ? { customerAccountId: value("customerAccountId") } : {}), ...(value("counterparty") ? { counterparty: value("counterparty") } : {}), amountCents: moneyCents(value("amount")), competenceAt: iso("competenceAt"), dueAt: iso("dueAt"), status: settled ? "SETTLED" : "PLANNED", ...(settled ? { settledAt: iso("settledAt"), paymentConfirmed: form.get("paymentConfirmed") === "on" } : {}) };
      if (kind === "RECORD_PAYMENT") {
        if (!invoice) throw new Error("Selecione uma cobrança em aberto.");
        payload = { kind, invoiceId: invoice.id, expectedRevision: invoice.revision, financialAccountId: value("financialAccountId"), amountCents: moneyCents(value("amount")), receivedAt: iso("receivedAt"), method: value("method"), reference: value("reference"), receiptConfirmed: form.get("receiptConfirmed") === "on" };
      }
      const parsed = copilotActionSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
      await onPropose(parsed.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Revise os dados da ação."); }
  }
  return <form className={styles.actionForm} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
    <fieldset disabled={busy}>
      <legend>{labels[kind]}</legend>
      {kind === "CREATE_TASK" ? <>
        <label>Lead<select name="leadId" required>{optionList(options.leads)}</select></label>
        {field("title", "Título da tarefa", { required: true, maxLength: 200 })}
        <label>Descrição<textarea maxLength={2000} name="description" rows={2} /></label>
        <div className={styles.fieldRow}><label>Tipo<select defaultValue="GENERAL" name="taskKind"><option value="GENERAL">Geral</option><option value="CALL">Ligação</option><option value="MESSAGE">Mensagem</option><option value="EMAIL">E-mail</option><option value="MEETING">Reunião</option><option value="FOLLOW_UP">Follow-up</option></select></label><label>Prioridade<select defaultValue="MEDIUM" name="priority"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div>
        {field("dueAt", "Prazo", { type: "datetime-local", required: true })}
        <p>O responsável e o vínculo aparecem na prévia. Criar uma tarefa não envia mensagens ao lead.</p>
      </> : null}
      {kind === "UPDATE_CUSTOMER" ? <>
        <label>Cliente<select onChange={(event) => setCustomerId(event.target.value)} required value={customerId}>{optionList(options.customers)}</select></label>
        {customer ? <div className={styles.customerFields} key={`${customer.id}:${customer.revision}`}>
          {field("name", "Nome", { defaultValue: customer.name, required: true, maxLength: 200 })}
          {field("legalName", "Razão social", { defaultValue: customer.legalName ?? "", maxLength: 240 })}
          {field("domain", "Domínio do site", { defaultValue: customer.domain ?? "", maxLength: 253 })}
          <label>Segmento<select defaultValue={customer.segment} name="segment"><option value="UNKNOWN">Não informado</option><option value="PUBLIC_SECTOR">Setor público</option><option value="POLITICAL">Político</option><option value="PRIVATE_SECTOR">Setor privado</option><option value="NONPROFIT">Sem fins lucrativos</option><option value="OTHER">Outro</option></select></label>
          <label>Porte<select defaultValue={customer.size} name="size"><option value="UNKNOWN">Não informado</option><option value="SOLO">Individual</option><option value="SMALL">Pequeno</option><option value="MEDIUM">Médio</option><option value="LARGE">Grande</option><option value="ENTERPRISE">Corporativo</option></select></label>
        </div> : <p>Nenhum cliente editável disponível.</p>}
        <p>Somente os campos alterados serão enviados. A prévia mostra os valores anteriores e os novos.</p>
      </> : null}
      {kind === "CREATE_EXPENSE" ? <>
        {field("description", "Descrição", { required: true, maxLength: 240 })}
        {field("counterparty", "Fornecedor / favorecido", { maxLength: 160 })}
        <label>Categoria<select name="categoryId" required>{optionList(options.categories)}</select></label>
        <label>Cliente vinculado (opcional)<select defaultValue="" name="customerAccountId"><option value="">Sem vínculo</option>{optionList(options.customers)}</select></label>
        {field("amount", "Valor em reais", { required: true, inputMode: "decimal" })}
        {field("competenceAt", "Data de competência", { type: "datetime-local", required: true, defaultValue: localDateTime() })}
        {field("dueAt", "Vencimento", { type: "datetime-local", required: true })}
        <label>Situação<select onChange={(event) => setSettled(event.target.value === "SETTLED")} value={settled ? "SETTLED" : "PLANNED"}><option value="PLANNED">Prevista, ainda não paga</option><option value="SETTLED">Pagamento já realizado</option></select></label>
        {settled ? <>{field("settledAt", "Data do pagamento", { type: "datetime-local", required: true })}<label className={styles.checkbox}><input name="paymentConfirmed" required type="checkbox" />Confirmo que esta despesa já foi paga na conta selecionada.</label></> : null}
      </> : null}
      {kind === "RECORD_PAYMENT" ? <>
        <label>Cobrança<select onChange={(event) => setInvoiceId(event.target.value)} required value={invoiceId}>{options.invoices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {invoice ? <p>Saldo em aberto: <strong>{currency(invoice.outstandingCents)}</strong>. É possível registrar um recebimento parcial.</p> : <p>Nenhuma cobrança em aberto disponível.</p>}
        {field("amount", "Valor recebido em reais", { required: true, inputMode: "decimal" })}
        {field("receivedAt", "Quando recebeu", { type: "datetime-local", required: true })}
        <label>Forma de recebimento<select defaultValue="PIX" name="method"><option value="PIX">Pix</option><option value="BANK_TRANSFER">Transferência</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="OTHER">Outro</option></select></label>
        {field("reference", "Referência do comprovante", { required: true, maxLength: 180 })}
        <label className={styles.checkbox}><input name="receiptConfirmed" required type="checkbox" />Confirmo o recebimento real na conta selecionada.</label>
      </> : null}
      {kind === "CREATE_EXPENSE" || kind === "RECORD_PAYMENT" ? <label>Conta financeira<select name="financialAccountId" required>{optionList(options.financialAccounts)}</select></label> : null}
      <button className={styles.primaryButton} type="submit">Preparar prévia</button>
    </fieldset>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </form>;
}

export function CopilotDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [tab, setTab] = useState<"chat" | "actions" | "history">("chat");
  const [kind, setKind] = useState<CopilotAction["kind"]>("CREATE_TASK");
  const [refreshCount, setRefreshCount] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch("/api/ai/copilot", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { result?: Screen; error?: { message?: string } };
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível carregar as ações e o histórico.");
      if (!active) return;
      const result = body.result;
      setScreen(result);
      setMessages((current) => [...current, ...result.pending.filter((proposal) => !current.some((message) => message.result?.proposal?.id === proposal.id)).map((proposal): Message => ({ id: proposal.id, role: "COPILOT", text: proposal.resuming ? "Recupere o resultado da confirmação anterior. A mesma ação não será duplicada." : "Você tem uma proposta aguardando revisão.", result: { answer: "", proposal, links: [] } }))]);
      setResolvedProposals((current) => [...new Set([...current, ...result.history.filter((item) => ["PUBLISHED", "CANCELLED"].includes(item.status)).map((item) => item.id)])]);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar o Copilot."); });
    return () => { active = false; };
  }, [open, refreshCount]);

  async function send(command: unknown): Promise<QueryResult> {
    const response = await fetch("/api/ai/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const body = await response.json() as { result?: QueryResult; error?: { message?: string } };
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? "Não foi possível concluir a solicitação.");
    return body.result;
  }
  const append = (result: QueryResult) => setMessages((current) => [...current, { id: crypto.randomUUID(), role: "COPILOT", text: result.answer, result }]);

  async function ask(value: string) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true); setError(null); setQuestion("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "USER", text: prompt }]);
    try {
      append(await send({ action: "CHAT", message: prompt, history: messages.slice(-12).map((message) => ({ role: message.role === "USER" ? "user" : "assistant", content: message.text.slice(0, 6000) })) }));
      setRefreshCount((count) => count + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível consultar o Copilot."); }
    finally { setBusy(false); }
  }

  async function propose(payload: CopilotAction) {
    if (busy) return;
    setBusy(true); setError(null);
    try { append(await send({ action: "PROPOSE", payload })); setTab("chat"); setRefreshCount((count) => count + 1); }
    finally { setBusy(false); }
  }

  async function decide(proposal: Proposal, action: "CONFIRM" | "CANCEL") {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await send({ action, proposalId: proposal.id, expectedRevision: proposal.revision, ...(action === "CONFIRM" ? { confirmed: true } : {}) });
      setResolvedProposals((current) => [...current, proposal.id]); append(result);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao confirmar a proposta."); }
    finally { setBusy(false); setRefreshCount((count) => count + 1); }
  }

  const selectedKind = screen?.options.capabilities.includes(kind) ? kind : screen?.options.capabilities[0];
  return <aside aria-hidden={!open} aria-label="Chat do Copilot" className={styles.drawer} data-open={open} id="copilot-drawer" inert={!open}>
    <header className={styles.header}><span className={styles.copilotIcon}><Icon name="copilot" size={18} /></span><div><strong>Copilot</strong><small>{screen?.mode === "LOCAL" ? "Consultas e ações locais" : "Dados autorizados do CRM"}</small></div><button aria-label="Fechar Copilot" className={styles.close} onClick={onClose} type="button">×</button></header>
    <nav aria-label="Seções do Copilot" className={styles.tabs}>{([['chat', 'Conversa'], ['actions', 'Ações'], ['history', 'Histórico']] as const).map(([value, label]) => <button aria-current={tab === value ? "page" : undefined} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</nav>
    <div className={styles.conversation}>
      {tab === "actions" ? <>
        <p className={styles.panelDescription}>Prepare a alteração, revise seus efeitos e confirme na conversa. Suas permissões são verificadas em cada etapa.</p>
        {screen ? selectedKind ? <><label className={styles.actionSelector}>Ação<select disabled={busy} onChange={(event) => setKind(event.target.value as CopilotAction["kind"])} value={selectedKind}>{screen.options.capabilities.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><ActionForm busy={busy} key={selectedKind} kind={selectedKind} onPropose={propose} options={screen.options} /></> : <p className={styles.panelDescription}>Nenhuma ação disponível para as suas permissões atuais.</p> : <p role="status">Carregando ações…</p>}
        {screen?.options.truncated ? <p className={styles.panelDescription}>A lista mostra até 100 registros por módulo. Use o módulo correspondente para localizar registros fora desta lista.</p> : null}
        <Link className={styles.moduleLink} href="/oportunidades" onClick={onClose}>Preparar fechamento de venda no pipeline ↗</Link>
      </> : null}
      {tab === "history" ? <>
        <p className={styles.panelDescription}>Suas últimas 30 propostas autorizadas ficam salvas nesta empresa, incluindo confirmações e cancelamentos.</p>
        <button className={styles.refreshButton} disabled={busy} onClick={() => setRefreshCount((count) => count + 1)} type="button">Atualizar histórico</button>
        {screen?.history.length ? screen.history.map((item) => <article className={styles.historyItem} key={item.id}><strong>{labels[item.type as keyof typeof labels] ?? item.type}</strong><span>{statusLabels[item.status] ?? item.status}</span><small>Criada em {dateTime(item.createdAt)}{item.approvedAt ? ` · Confirmada em ${dateTime(item.approvedAt)}` : ""}{item.cancelledAt ? ` · Cancelada em ${dateTime(item.cancelledAt)}` : ""}</small><details><summary>Ver dados e efeitos</summary><div className={styles.proposal}><PreviewDetails preview={item.preview} /></div></details>{["DRAFT", "EXECUTING", "EXECUTION_FAILED"].includes(item.status) ? <button onClick={() => setTab("chat")} type="button">Revisar na conversa</button> : null}</article>) : <p className={styles.panelDescription}>{screen ? "Nenhuma proposta no seu histórico." : "Carregando histórico…"}</p>}
      </> : null}
      {tab === "chat" ? <div aria-live="polite">
        {!messages.length ? <div className={styles.welcome}><span><Icon name="copilot" size={24} /></span><strong>Como posso ajudar?</strong><p>Consulte dados da empresa ou abra Ações para criar tarefas, atualizar clientes, registrar despesas e recebimentos.</p><div className={styles.suggestions}>{suggestions.map((suggestion) => <button disabled={busy} key={suggestion} onClick={() => void ask(suggestion)} type="button">{suggestion}</button>)}</div></div> : messages.map((message) => <article className={styles.message} data-role={message.role} key={message.id}><div>{message.text}</div>{message.result?.proposal ? (() => {
          const original = message.result.proposal;
          const proposal = screen?.pending.find((item) => item.id === original.id) ?? original;
          const resolved = resolvedProposals.includes(proposal.id);
          const expired = !proposal.resuming && Date.now() >= new Date(proposal.expiresAt).getTime();
          return <section aria-label="Prévia da ação" className={styles.proposal}><strong>Revise antes de confirmar</strong><PreviewDetails preview={proposal.preview} /><p>{proposal.resuming ? "Recupere a confirmação anterior com a mesma proposta." : expired ? "Prévia expirada. Prepare uma nova proposta com dados atualizados." : `Prévia válida até ${dateTime(proposal.expiresAt)}.`}</p>{resolved ? <small>Proposta finalizada. Consulte o histórico.</small> : <div className={styles.proposalActions}><button disabled={busy || expired} onClick={() => void decide(proposal, "CONFIRM")} type="button">{proposal.resuming ? "Recuperar resultado" : "Confirmar ação"}</button>{!proposal.resuming ? <button disabled={busy} onClick={() => void decide(proposal, "CANCEL")} type="button">Cancelar</button> : null}</div>}</section>;
        })() : null}{message.result?.links.length ? <div className={styles.links}>{message.result.links.slice(0, 5).map((link) => <Link href={link.href} key={`${link.entityType}:${link.href}`} onClick={onClose}>{link.label}<span>↗</span></Link>)}</div> : null}</article>)}
        {busy ? <div className={styles.typing} role="status"><span /><span /><span /><small>Copilot processando</small></div> : null}<div ref={endRef} />
      </div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
    {tab === "chat" ? <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}><textarea aria-label="Pergunte ao Copilot" maxLength={4_000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(question); } }} placeholder="Pergunte ou solicite uma ação…" ref={inputRef} rows={2} value={question} /><button aria-label="Enviar pergunta" disabled={busy || !question.trim()} type="submit"><Icon name="mais" size={16} /></button><small>Enter para enviar · Alterações exigem confirmação na prévia</small></form> : <footer className={styles.footer}>Toda ação confirmada fica no histórico desta empresa.</footer>}
  </aside>;
}
