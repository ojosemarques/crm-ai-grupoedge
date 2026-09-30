"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, Surface } from "@/components/ui/surface";
import type { getOutboundCampaignService } from "@/modules/campaigns/application/outbound-campaign-service";
import styles from "./campaigns-workspace.module.css";

type Screen = Awaited<ReturnType<ReturnType<typeof getOutboundCampaignService>["screen"]>>;
type Campaign = Screen["campaigns"][number];
type Recipient = Campaign["recipients"][number];
type Preview = Readonly<{ campaignId: string; snapshotHash: string; total: number; eligible: number; sample: ReadonlyArray<Readonly<{ leadId: string; address: string; status: string; suppressionReason: string | null; overlapReason: string | null }>> }>;
type Tab = "preview" | "receipts" | "metrics" | "actions";

const statusLabels: Record<string, string> = { DRAFT: "Rascunho", PREVIEWED: "Prévia congelada", APPROVED: "Aprovada", RUNNING: "Em execução", COMPLETED: "Concluída", CANCELLED: "Cancelada", SUPPRESSED: "Suprimido", OVERLAP_BLOCKED: "Sobreposição bloqueada", QUEUED: "Na fila", PROCESSING: "Processando", ACCEPTED: "Aceito", DELIVERED: "Entregue", RESPONDED: "Respondido", RETRY_PENDING: "Retry pendente", FAILED: "Falhou" };
const channelLabels: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", FLASH: "Flash", VOICE: "Voz" };
const reasonLabels: Record<string, string> = { NO_CONTACT_POINT: "Sem ponto de contato", DO_NOT_CONTACT: "Não contatar", OPT_OUT: "Descadastro/opt-out", ACTIVE_AGENT_CONVERSATION: "Conversa ativa com agente", ACTIVE_CAMPAIGN: "Já está em outra campanha", TRANSIENT_FAILURE: "Falha transitória", PERMANENT_FAILURE: "Falha permanente" };

function money(cents: string | number | bigint) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
}

function date(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function ids(value: string) {
  return value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

function statusTone(status: string) {
  if (["COMPLETED", "DELIVERED", "RESPONDED", "ACCEPTED"].includes(status)) return "success";
  if (["FAILED", "CANCELLED", "SUPPRESSED", "OVERLAP_BLOCKED"].includes(status)) return "danger";
  if (["RUNNING", "APPROVED", "QUEUED", "RETRY_PENDING"].includes(status)) return "warning";
  return "neutral";
}

export function CampaignsWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [approvalReason, setApprovalReason] = useState("Público, template, custo e ações pós-envio revisados.");
  const [cancelReason, setCancelReason] = useState("Campanha cancelada pela operação após revisão.");
  const [scenario, setScenario] = useState<"ACCEPT" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE">("ACCEPT");
  const [csvAddresses, setCsvAddresses] = useState("");

  const totals = useMemo(() => initial.campaigns.reduce((result, campaign) => ({
    volume: result.volume + campaign.estimatedVolume,
    cost: result.cost + Number(campaign.metrics.costCents),
    delivered: result.delivered + campaign.metrics.delivered,
    responded: result.responded + campaign.metrics.responded,
  }), { volume: 0, cost: 0, delivered: 0, responded: 0 }), [initial.campaigns]);

  async function request(body: Record<string, unknown>, success: string) {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "A ação não foi concluída.");
      setFeedback({ tone: "success", text: success });
      router.refresh();
      return payload.result;
    } catch (error) {
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : "A ação não foi concluída." });
      return null;
    } finally { setPending(false); }
  }

  async function loadCampaign(campaignId: string) {
    setPending(true); setFeedback(null); setPreview(null);
    try {
      const response = await fetch(`/api/campaigns?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
      const payload = await response.json() as { result?: Screen; error?: { message?: string } };
      if (!response.ok || !payload.result?.campaigns[0]) throw new Error(payload.error?.message ?? "Campanha não encontrada.");
      setSelected(payload.result.campaigns[0]); setTab("preview");
    } catch (error) { setFeedback({ tone: "danger", text: error instanceof Error ? error.message : "Campanha não encontrada." }); }
    finally { setPending(false); }
  }

  async function refreshSelected(campaignId: string) {
    const response = await fetch(`/api/campaigns?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json() as { result?: Screen };
      if (payload.result?.campaigns[0]) setSelected(payload.result.campaigns[0]);
    }
    router.refresh();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scheduledLocal = String(data.get("scheduledAt") ?? "");
    const result = await request({ action: "CREATE", campaign: {
      name: data.get("name"), channel: data.get("channel"), providerMode: "LOCAL_SIMULATOR", purposeKey: data.get("purposeKey"), templateBody: data.get("templateBody"),
      segment: { leadIds: ids(String(data.get("leadIds") ?? "")), csvAddresses: ids(csvAddresses), sourceIds: ids(String(data.get("sourceIds") ?? "")), tagIds: ids(String(data.get("tagIds") ?? "")), offerIds: ids(String(data.get("offerIds") ?? "")), fields: { city: String(data.get("city") ?? "") || undefined, stateCode: String(data.get("stateCode") ?? "").toUpperCase() || undefined, jobTitle: String(data.get("jobTitle") ?? "") || undefined, status: String(data.get("leadStatus") ?? "") || undefined, priority: String(data.get("priority") ?? "") || undefined } },
      postActions: { tagIds: ids(String(data.get("postTagIds") ?? "")), taskTitle: String(data.get("taskTitle") ?? "") || undefined, assignMemberId: String(data.get("assignMemberId") ?? "") || undefined, createOpportunityName: String(data.get("createOpportunityName") ?? "") || undefined },
      windowStartMinute: Number(data.get("windowStartMinute")), windowEndMinute: Number(data.get("windowEndMinute")), timeZone: data.get("timeZone"), scheduledAt: scheduledLocal ? new Date(scheduledLocal).toISOString() : undefined, maxRecipients: Number(data.get("maxRecipients")), unitCostCents: Math.round(Number(data.get("unitCost")) * 100),
    } }, "Rascunho criado. Gere a prévia para congelar o público elegível.") as { id?: string } | null;
    if (result?.id) await loadCampaign(result.id);
  }

  async function previewCampaign() {
    if (!selected) return;
    const result = await request({ action: "PREVIEW", campaignId: selected.id }, "Prévia congelada. Confira público, supressões e sobreposições antes de aprovar.") as Preview | null;
    if (result) { setPreview(result); await refreshSelected(selected.id); setTab("preview"); }
  }

  async function command(body: Record<string, unknown>, success: string) {
    if (!selected) return;
    const result = await request(body, success);
    if (result) await refreshSelected(selected.id);
  }

  function importCsv(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result ?? "").split(/\r?\n/).map((row) => row.split(/[;,]/)[0]?.trim() ?? "").filter(Boolean);
      setCsvAddresses(rows.filter((row, index) => !(index === 0 && /telefone|phone|endereco|address/i.test(row))).join("\n"));
    };
    reader.readAsText(file);
  }

  return <div className={styles.workspace}>
    <section className={styles.notice}><div><strong>Simulador local · nenhum envio externo</strong><p>WhatsApp, SMS, Flash e voz dependem de autorização por canal, finalidade e fornecedor. A fila atual cria recibos locais e mantém egress externo bloqueado.</p></div><Link href="/aquisicao">Abrir Aquisição e mídia →</Link></section>

    <section aria-label="Resumo das campanhas" className={styles.metrics}>
      <article className={styles.metric}><span>Campanhas</span><strong>{initial.campaigns.length}</strong><small>comunicação em escala</small></article>
      <article className={styles.metric}><span>Volume estimado</span><strong>{totals.volume}</strong><small>público elegível congelado</small></article>
      <article className={styles.metric}><span>Entregues</span><strong>{totals.delivered}</strong><small>recibos conciliados</small></article>
      <article className={styles.metric}><span>Respondidos</span><strong>{totals.responded}</strong><small>retorno por destinatário</small></article>
      <article className={styles.metric}><span>Custo realizado</span><strong>{money(totals.cost)}</strong><small>simulação local</small></article>
    </section>
    {feedback ? <p className={styles.feedback} data-tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.text}</p> : null}

    <div className={styles.layout}>
      <div className="space-y-5">
        <Surface className={styles.panel}><SectionHeader title="Novo rascunho" description="Defina segmento, mensagem, limites e ações. Nada entra na fila sem prévia e aprovação por hash." />
          <form className={styles.form} onSubmit={create}>
            <div className={styles.fields}><label className={`${styles.field} ${styles.span2}`}>Nome<input className={styles.input} name="name" minLength={3} required /></label><label className={styles.field}>Canal<select className={styles.input} defaultValue="WHATSAPP" name="channel"><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="FLASH">Flash</option><option value="VOICE">Voz</option></select></label><label className={styles.field}>Finalidade<input className={styles.input} defaultValue="relacionamento" name="purposeKey" minLength={2} required /></label><label className={`${styles.field} ${styles.span2}`}>Template<textarea className={styles.input} defaultValue="Olá, {{nome}}. Temos uma atualização para você." name="templateBody" required /><span className={styles.hint}>Variáveis disponíveis: nome, cidade e UF.</span></label></div>
            <section className={styles.formSection}><h3>Segmento real</h3><div className={styles.fields}><label className={`${styles.field} ${styles.span2}`}>Lista de IDs de leads<textarea className={styles.input} name="leadIds" placeholder="UUIDs separados por linha ou vírgula" /></label><label className={`${styles.field} ${styles.span2}`}>Endereços de uma lista/CSV<textarea className={styles.input} onChange={(event) => setCsvAddresses(event.target.value)} placeholder="Um telefone normalizado por linha" value={csvAddresses} /><input accept=".csv,text/csv,text/plain" aria-label="Importar arquivo CSV de endereços" onChange={(event) => importCsv(event.target.files?.[0])} type="file" /><span className={styles.hint}>O arquivo é lido neste navegador; somente os valores entram na definição do segmento.</span></label><label className={styles.field}>IDs de origens<input className={styles.input} name="sourceIds" /></label><label className={styles.field}>IDs de tags<input className={styles.input} name="tagIds" /></label><label className={styles.field}>IDs de ofertas<input className={styles.input} name="offerIds" /></label><label className={styles.field}>Cidade<input className={styles.input} name="city" /></label><label className={styles.field}>UF<input className={styles.input} maxLength={2} name="stateCode" /></label><label className={styles.field}>Cargo<input className={styles.input} name="jobTitle" /></label><label className={styles.field}>Status<select className={styles.input} name="leadStatus"><option value="">Qualquer</option><option value="OPEN">Aberto</option><option value="QUALIFIED">Qualificado</option><option value="DISQUALIFIED">Desqualificado</option><option value="CONVERTED">Convertido</option><option value="ARCHIVED">Arquivado</option></select></label><label className={styles.field}>Prioridade<select className={styles.input} name="priority"><option value="">Qualquer</option><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div></section>
            <section className={styles.formSection}><h3>Janela, agenda e custo</h3><div className={styles.fields}><label className={styles.field}>Início em minutos<input className={styles.input} defaultValue="480" max="1439" min="0" name="windowStartMinute" type="number" /></label><label className={styles.field}>Fim em minutos<input className={styles.input} defaultValue="1200" max="1440" min="1" name="windowEndMinute" type="number" /></label><label className={styles.field}>Fuso<input className={styles.input} defaultValue="America/Sao_Paulo" name="timeZone" /></label><label className={styles.field}>Agendar para<input className={styles.input} name="scheduledAt" type="datetime-local" /></label><label className={styles.field}>Limite de destinatários<input className={styles.input} defaultValue="100" max="10000" min="1" name="maxRecipients" type="number" /></label><label className={styles.field}>Custo unitário (R$)<input className={styles.input} defaultValue="0" min="0" name="unitCost" step="0.01" type="number" /></label></div></section>
            <section className={styles.formSection}><h3>Ações pós-envio sujeitas à aprovação</h3><div className={styles.fields}><label className={`${styles.field} ${styles.span2}`}>IDs de tags<input className={styles.input} name="postTagIds" /></label><label className={styles.field}>Criar tarefa<input className={styles.input} name="taskTitle" /></label><label className={styles.field}>Atribuir ao membro<input className={styles.input} name="assignMemberId" placeholder="UUID opcional" /></label><label className={`${styles.field} ${styles.span2}`}>Criar negócio<input className={styles.input} name="createOpportunityName" placeholder="Nome-base opcional" /></label></div></section>
            <Button disabled={pending} type="submit">{pending ? "Salvando…" : "Criar rascunho local"}</Button>
          </form>
        </Surface>
        <Surface className={styles.panel}><SectionHeader title="Campanhas de envio" description="Módulo operacional independente de campanhas de aquisição e mídia." /><div className={styles.campaignList}>{initial.campaigns.length ? initial.campaigns.map((campaign) => <button className={styles.campaign} data-selected={selected?.id === campaign.id} key={campaign.id} onClick={() => void loadCampaign(campaign.id)} type="button"><div className={styles.campaignHead}><div><strong>{campaign.name}</strong><small>{channelLabels[campaign.channel] ?? campaign.channel} · criada em {date(campaign.createdAt)}</small></div><span className="status-badge" data-tone={statusTone(campaign.status)}>{statusLabels[campaign.status] ?? campaign.status}</span></div><div className={styles.campaignMeta}><span>{campaign.estimatedVolume} elegíveis</span><span>{money(campaign.estimatedCostCents)} estimados</span><span>{campaign.metrics.responded} respostas</span></div></button>) : <p className={styles.empty}>Crie um rascunho para começar. O público só será materializado ao gerar a prévia.</p>}</div></Surface>
      </div>

      <Surface className={styles.panel}>{selected ? <CampaignDetail campaign={selected} preview={preview} tab={tab} setTab={setTab} pending={pending} approvalReason={approvalReason} setApprovalReason={setApprovalReason} cancelReason={cancelReason} setCancelReason={setCancelReason} scenario={scenario} setScenario={setScenario} onPreview={previewCampaign} onCommand={command} /> : <div className={styles.empty}><strong>Selecione uma campanha</strong><p>Abra um rascunho para pré-visualizar o público ou acompanhe recibos e métricas de uma execução.</p></div>}</Surface>
    </div>
  </div>;
}

function CampaignDetail({ campaign, preview, tab, setTab, pending, approvalReason, setApprovalReason, cancelReason, setCancelReason, scenario, setScenario, onPreview, onCommand }: Readonly<{ campaign: Campaign; preview: Preview | null; tab: Tab; setTab: (tab: Tab) => void; pending: boolean; approvalReason: string; setApprovalReason: (value: string) => void; cancelReason: string; setCancelReason: (value: string) => void; scenario: "ACCEPT" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE"; setScenario: (value: "ACCEPT" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE") => void; onPreview: () => Promise<void>; onCommand: (body: Record<string, unknown>, success: string) => Promise<void> }>) {
  const snapshotHash = preview?.snapshotHash ?? campaign.snapshotHash;
  const recipients = campaign.recipients as Recipient[];
  return <div className={styles.detail}>
    <header className={styles.detailHead}><div><h2>{campaign.name}</h2><p>{channelLabels[campaign.channel] ?? campaign.channel} · finalidade {campaign.purposeKey} · {date(campaign.scheduledAt)}</p></div><span className="status-badge" data-tone={statusTone(campaign.status)}>{statusLabels[campaign.status] ?? campaign.status}</span></header>
    <dl className={styles.summary}><div><dt>Volume elegível</dt><dd>{campaign.estimatedVolume}</dd></div><div><dt>Custo estimado</dt><dd>{money(campaign.estimatedCostCents)}</dd></div><div><dt>Janela</dt><dd>{campaign.windowStartMinute}–{campaign.windowEndMinute}</dd></div><div><dt>Provider</dt><dd>Local</dd></div></dl>
    <div className={styles.gate}><strong>EXTERNAL_BLOCKED</strong><p>A execução disponível é determinística e local. Nenhum provider, número, finalidade ou egress externo foi autorizado.</p></div>
    <nav aria-label="Detalhes da campanha" className={styles.tabs}>{(["preview", "receipts", "metrics", "actions"] as const).map((item) => <button aria-selected={tab === item} key={item} onClick={() => setTab(item)} role="tab" type="button">{{ preview: "Prévia e aprovação", receipts: "Recibos", metrics: "Métricas", actions: "Execução" }[item]}</button>)}</nav>
    {tab === "preview" ? <section className={styles.section}><div className={styles.sectionHead}><div><h3>Público congelado</h3><p>Supressões e sobreposições ficam fora da fila.</p></div>{["DRAFT", "PREVIEWED"].includes(campaign.status) ? <Button disabled={pending} onClick={() => void onPreview()} size="sm" variant="secondary">Gerar nova prévia</Button> : null}</div>{snapshotHash ? <><span className={styles.hint}>Hash aprovado separadamente</span><code className={styles.hash}>{snapshotHash}</code></> : <p className={styles.empty}>Gere a prévia para calcular o público, a amostra e o hash.</p>}{preview ? <div className={styles.previewList}>{preview.sample.map((row) => <div className={styles.previewRow} key={row.leadId}><div><strong className={styles.masked}>{row.address}</strong><small>{row.suppressionReason ? reasonLabels[row.suppressionReason] ?? row.suppressionReason : row.overlapReason ? reasonLabels[row.overlapReason] ?? row.overlapReason : "Elegível para a fila"}</small></div><span className="status-badge" data-tone={statusTone(row.status)}>{statusLabels[row.status] ?? row.status}</span></div>)}</div> : null}{campaign.status === "PREVIEWED" && snapshotHash ? <div className={styles.approval}><label>Motivo da aprovação<textarea className={styles.input} minLength={8} onChange={(event) => setApprovalReason(event.target.value)} value={approvalReason} /></label><Button disabled={pending || approvalReason.trim().length < 8} onClick={() => void onCommand({ action: "APPROVE", campaignId: campaign.id, expectedSnapshotHash: snapshotHash, reason: approvalReason }, "Campanha aprovada pelo hash exibido. Agora pode entrar na fila local.")}>Aprovar hash, público e pós-ações</Button></div> : null}</section> : null}
    {tab === "receipts" ? <section className={styles.section}><div className={styles.sectionHead}><div><h3>Recibos por destinatário</h3><p>Endereços mascarados; retries compartilham a mesma chave idempotente.</p></div></div>{recipients.length ? <DataTableShell className={styles.table}><table><thead><tr><th>Endereço</th><th>Status</th><th>Tentativas</th><th>Recibo</th><th>Custo</th><th>Motivo</th><th>Callback local</th></tr></thead><tbody>{recipients.map((row) => <tr key={row.id}><td className={styles.masked}>{row.addressSnapshot}</td><td><span className="status-badge" data-tone={statusTone(row.status)}>{statusLabels[row.status] ?? row.status}</span></td><td>{row.attemptCount}</td><td className={styles.masked}>{row.providerReceiptId ?? "—"}</td><td>{money(row.costCents)}</td><td>{row.suppressionReason ? reasonLabels[row.suppressionReason] ?? row.suppressionReason : row.overlapReason ? reasonLabels[row.overlapReason] ?? row.overlapReason : row.lastError ? reasonLabels[row.lastError] ?? row.lastError : "—"}</td><td>{["ACCEPTED", "DELIVERED", "RESPONDED"].includes(row.status) ? <div className={styles.actions}>{row.status === "ACCEPTED" ? <Button disabled={pending} onClick={() => void onCommand({ action: "RECORD_STATUS", campaignId: campaign.id, recipientId: row.id, status: "DELIVERED", externalEventId: `local-delivered-${crypto.randomUUID()}` }, "Recibo local marcado como entregue.")} size="sm" variant="secondary">Entregue</Button> : null}{row.status !== "RESPONDED" ? <Button disabled={pending} onClick={() => void onCommand({ action: "RECORD_STATUS", campaignId: campaign.id, recipientId: row.id, status: "RESPONDED", externalEventId: `local-response-${crypto.randomUUID()}` }, "Resposta local conciliada.")} size="sm" variant="secondary">Respondido</Button> : null}</div> : "—"}</td></tr>)}</tbody></table></DataTableShell> : <p className={styles.empty}>A prévia ainda não materializou destinatários.</p>}</section> : null}
    {tab === "metrics" ? <section className={styles.section}><div className={styles.sectionHead}><div><h3>Métricas conciliadas</h3><p>Contagens derivadas dos recibos persistidos.</p></div><span className="status-badge" data-tone={campaign.metrics.reconciled ? "success" : "warning"}>{campaign.metrics.reconciled ? "Conciliada" : "Em aberto"}</span></div><dl className={styles.summary}><div><dt>Elegíveis</dt><dd>{campaign.metrics.eligible}</dd></div><div><dt>Na fila/retry</dt><dd>{campaign.metrics.queued}</dd></div><div><dt>Aceitos</dt><dd>{campaign.metrics.accepted}</dd></div><div><dt>Entregues</dt><dd>{campaign.metrics.delivered}</dd></div><div><dt>Respondidos</dt><dd>{campaign.metrics.responded}</dd></div><div><dt>Falhos</dt><dd>{campaign.metrics.failed}</dd></div><div><dt>Suprimidos</dt><dd>{campaign.metrics.suppressed}</dd></div><div><dt>Sobreposição</dt><dd>{campaign.metrics.overlapBlocked}</dd></div><div><dt>Cancelados</dt><dd>{campaign.metrics.cancelled}</dd></div><div><dt>Custo realizado</dt><dd>{money(campaign.metrics.costCents)}</dd></div><div><dt>Estimativa</dt><dd>{money(campaign.estimatedCostCents)}</dd></div></dl></section> : null}
    {tab === "actions" ? <section className={styles.section}><div className={styles.sectionHead}><div><h3>Fila e controle</h3><p>Processamento individual permite provar retry e ausência de envio duplo.</p></div></div>{campaign.status === "APPROVED" ? <Button disabled={pending} onClick={() => void onCommand({ action: "START", campaignId: campaign.id }, "Campanha iniciada na fila local.")}>Iniciar fila local</Button> : null}{campaign.status === "RUNNING" ? <div className={styles.approval}><label>Cenário do próximo recibo<select className={styles.input} onChange={(event) => setScenario(event.target.value as typeof scenario)} value={scenario}><option value="ACCEPT">Aceitar</option><option value="TRANSIENT_FAILURE">Falha transitória e retry</option><option value="PERMANENT_FAILURE">Falha permanente</option></select></label><Button disabled={pending} onClick={() => void onCommand({ action: "PROCESS_NEXT", campaignId: campaign.id, scenario }, "Próximo destinatário processado sem egress externo.")}>Processar próximo</Button></div> : null}{!["COMPLETED", "CANCELLED"].includes(campaign.status) ? <div className={styles.approval}><label>Motivo do cancelamento<textarea className={styles.input} minLength={8} onChange={(event) => setCancelReason(event.target.value)} value={cancelReason} /></label><Button disabled={pending || cancelReason.trim().length < 8} onClick={() => void onCommand({ action: "CANCEL", campaignId: campaign.id, reason: cancelReason }, "Campanha cancelada; itens pendentes foram retirados da fila.")} variant="destructive">Cancelar campanha</Button></div> : null}<div className={styles.gate}><strong>Ações pós-envio aprovadas no snapshot</strong><p>Tags, tarefa, negócio e atendente fazem parte do hash. Alterar o público ou a configuração exige nova prévia e nova aprovação.</p><code className={styles.hash}>{JSON.stringify(campaign.postActions)}</code></div></section> : null}
  </div>;
}
