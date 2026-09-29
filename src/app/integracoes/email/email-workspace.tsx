"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getEmailService } from "@/modules/integrations/application/email-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getEmailService>["screen"]>>;
const label: Record<string, string> = { LOCAL_SIMULATOR: "Simulador local", CONFIGURATION_INCOMPLETE: "Configuração incompleta", READY_FOR_EXTERNAL_HOMOLOGATION: "Pronto para homologação", PAUSED: "Pausado", EXTERNAL_DISABLED: "Externo desativado", PENDING_EXTERNAL: "Pendente de validação externa", UNKNOWN: "Não observado", VERIFIED_EXTERNAL: "Verificado externamente", FAILED_EXTERNAL: "Falhou externamente" };
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem registro";

export function EmailWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [from, setFrom] = useState("lead.001@example.invalid");
  const [subject, setSubject] = useState("Resposta sobre a solução");
  const [text, setText] = useState("Olá, gostaria de continuar a conversa.");

  async function command(action: string, data: unknown) {
    setPending(action); setFeedback(null);
    const response = await fetch("/api/integrations/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    const payload = await response.json() as { error?: { message?: string } };
    setPending(null);
    if (!response.ok) { setFeedback({ tone: "danger", text: payload.error?.message ?? "A operação de e-mail não foi concluída." }); return; }
    setFeedback({ tone: "success", text: action === "SIMULATE_INBOUND" ? "E-mail recebido no sink local e encaminhado à inbox." : "Configuração local atualizada sem egress." });
    router.refresh();
  }

  return <div className="space-y-5">
    <Surface tone="accent"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader title="Canal local, ativação externa adiada" description="Nenhum SMTP, mailbox, DNS ou webhook externo foi acionado. Provider accepted e delivered permanecem estados diferentes." /><span className="status-badge" data-tone="info">{label[initial.activationStatus]}</span></div></Surface>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><StatCard label="Na fila" value={initial.metrics.queued} hint="Aguardam sink local" /><StatCard label="Entregues" value={initial.metrics.delivered} hint="Somente simulação" /><StatCard label="Deferred" value={initial.metrics.deferred} hint="Retry elegível" /><StatCard label="Hard bounce" value={initial.metrics.hardBounce} hint="Gera suppression" /><StatCard label="Complaints" value={initial.metrics.complaint} hint="Bloqueio imediato" /><StatCard label="Replies" value={initial.metrics.replies} hint={`Denominador: ${initial.metrics.denominator}`} /></div>
    {feedback ? <p className="feedback-banner" data-tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.text}</p> : null}
    <div className="grid gap-5 xl:grid-cols-2">
      <Surface><SectionHeader title="Sender e domínio" description="Identidade fixa e autorizada no workspace; a interface nunca aceita From arbitrário para uma mensagem." /><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Remetente</dt><dd className="font-semibold">{initial.profile?.displayName ?? "Não configurado"}</dd></div><div><dt className="text-muted-foreground">Endereço</dt><dd className="font-semibold">{initial.profile?.senderAddress ?? "Não configurado"}</dd></div><div><dt className="text-muted-foreground">Envelope-from</dt><dd className="font-semibold">{initial.profile?.envelopeFrom ?? "Não configurado"}</dd></div><div><dt className="text-muted-foreground">Egress</dt><dd className="font-semibold">Desativado</dd></div></dl><div className="mt-4 flex flex-wrap gap-2">{initial.profile && initial.permissions.pause ? <Button onClick={() => void command(initial.profile!.operatingMode === "PAUSED" ? "RESUME" : "PAUSE", { revision: initial.profile!.revision })} variant="secondary">{initial.profile.operatingMode === "PAUSED" ? "Retomar sink" : "Pausar sink"}</Button> : null}<Button asChild variant="secondary"><Link href="/inbox?channels=EMAIL">Abrir e-mails</Link></Button></div></Surface>
      <Surface tone="subtle"><SectionHeader title="Entregabilidade honesta" description="Observações locais não equivalem a consulta DNS ou homologação do provider." /><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>SPF</dt><dd>{label[initial.profile?.spfStatus ?? "UNKNOWN"]}</dd></div><div className="flex justify-between gap-3"><dt>DKIM</dt><dd>{label[initial.profile?.dkimStatus ?? "UNKNOWN"]}</dd></div><div className="flex justify-between gap-3"><dt>DMARC</dt><dd>{label[initial.profile?.dmarcStatus ?? "UNKNOWN"]}</dd></div><div className="flex justify-between gap-3"><dt>Proveniência</dt><dd>{initial.profile?.domainStatusProvenance ?? "Sem observação"}</dd></div></dl><details className="mt-4"><summary className="cursor-pointer font-semibold">Checklist de ativação futura</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{initial.checklist.map((item) => <li key={item}>{item}</li>)}</ul></details></Surface>
    </div>
    <Surface><SectionHeader title="Simular entrada de e-mail" description="Cria um fato canônico com Message-ID; assunto sozinho nunca decide o thread." /><form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const id = crypto.randomUUID(); void command("SIMULATE_INBOUND", { externalEventId: `email-local:${id}`, from, subject, text, messageId: `<${id}@example.invalid>`, inReplyTo: null, references: [], occurredAt: new Date().toISOString() }); }}><label className="space-y-1 text-sm"><span className="font-semibold">Remetente fictício</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setFrom(event.target.value)} type="email" value={from} /></label><label className="space-y-1 text-sm"><span className="font-semibold">Assunto</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setSubject(event.target.value)} value={subject} /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Texto simples</span><textarea className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setText(event.target.value)} rows={3} value={text} /></label><div className="md:col-span-2"><Button disabled={pending !== null || !initial.permissions.testLocal || initial.profile?.operatingMode !== "LOCAL_SINK"} type="submit">{pending === "SIMULATE_INBOUND" ? "Processando…" : "Receber no sink local"}</Button></div></form></Surface>
    <Surface><SectionHeader title="Eventos recentes" description="Status, horário e threading vêm de registros persistidos. Open e click não são inferidos." />{initial.messages.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Assunto</th><th>Direção</th><th>Status</th><th>Message-ID</th><th>Data</th></tr></thead><tbody>{initial.messages.map((message) => <tr key={message.id}><td>{message.subject ?? "Sem assunto"}</td><td>{message.direction === "INBOUND" ? "Entrada" : "Saída"}</td><td>{message.status}</td><td className="max-w-64 truncate font-mono text-xs">{message.emailProfile?.messageIdHeader ?? "Pendente"}</td><td>{formatDate(message.occurredAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhum evento de e-mail. Use o simulador local para criar um exemplo seguro.</p>}</Surface>
    <div className="grid gap-5 xl:grid-cols-2"><Surface><SectionHeader title="Suppressions" description="Hard bounce, complaint e unsubscribe bloqueiam novas tentativas sem apagar o histórico." /><p className="mt-4 text-sm text-muted-foreground">{initial.suppressions.length ? `${initial.suppressions.length} evento(s) append-only neste recorte.` : "Nenhuma suppression registrada."}</p></Surface><Surface><SectionHeader title="Revisões" description="Thread, identidade ou status ambíguo exigem análise humana." /><p className="mt-4 text-sm text-muted-foreground">{initial.reviews.length ? `${initial.reviews.length} revisão(ões) aberta(s).` : "Nenhuma revisão pendente."}</p></Surface></div>
  </div>;
}
