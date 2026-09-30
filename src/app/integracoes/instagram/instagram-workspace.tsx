"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getInstagramService } from "@/modules/integrations/application/instagram-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getInstagramService>["screen"]>>;
type EventType = Screen["supportedEventTypes"][number];

const eventLabels: Record<EventType, string> = { DIRECT: "Direct", COMMENT: "Comentário", MENTION: "Menção", STORY_REPLY: "Resposta a story" };
const readinessLabels: Record<string, string> = { VALIDATED_LOCALLY: "Validado localmente", EXTERNAL_BLOCKED: "Externo bloqueado", NOT_TESTED: "Não testado" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function InstagramWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [eventType, setEventType] = useState<EventType>("DIRECT");
  const [username, setUsername] = useState("politizai_fixture");
  const [body, setBody] = useState("Olá, quero saber mais sobre a solução.");
  const [publicationReference, setPublicationReference] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function simulate() {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/integrations/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SIMULATE_INBOUND", data: { externalEventId: `instagram-local:${crypto.randomUUID()}`, eventType, username, body, publicationReference: publicationReference || null, occurredAt: new Date().toISOString() } }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "A fixture do Instagram não foi registrada.");
      setFeedback({ tone: "success", text: "Interação local registrada no inbox canônico. Nenhum dado foi enviado à Meta." });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : "A fixture do Instagram não foi registrada." });
    } finally { setPending(false); }
  }

  return <div className="space-y-5">
    <Surface tone="critical"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader title="Provider externo não homologado" description={initial.decision.reason} /><div className="flex flex-wrap gap-2"><span className="status-badge" data-tone="warning">Somente simulador local</span><span className="status-badge" data-tone="danger">Agente não validado</span></div></div><p className="mt-3 text-sm text-muted-foreground">A documentação pública confirma gatilhos do canal, mas não comprova paridade operacional do agente conversacional no Instagram sem conta de avaliação.</p></Surface>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><StatCard label="Conversas" value={initial.metrics.conversations} hint="Inbox canônico" /><StatCard label="Entradas" value={initial.metrics.inbound} hint="Fixtures persistidas" /><StatCard label="Saídas" value={initial.metrics.outbound} hint="Sem egress Meta" /><StatCard label="Tipos locais" value={initial.supportedEventTypes.length} hint="Direct e interações sociais" /><StatCard label="Validação externa" value="0" hint="Providers homologados" /></div>
    {feedback ? <p className="feedback-banner" data-tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.text}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <Surface><SectionHeader title="Simular interação recebida" description="A fixture usa Conversation, Message, identidade, fila, oportunidade e atividade canônicas do inbox." /><form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void simulate(); }}><label className="space-y-1 text-sm"><span className="font-semibold">Tipo de interação</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" onChange={(event) => setEventType(event.target.value as EventType)} value={eventType}>{initial.supportedEventTypes.map((item) => <option key={item} value={item}>{eventLabels[item]}</option>)}</select></label><label className="space-y-1 text-sm"><span className="font-semibold">Usuário fictício</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" maxLength={120} onChange={(event) => setUsername(event.target.value)} required value={username} /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Mensagem</span><textarea className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" maxLength={10000} onChange={(event) => setBody(event.target.value)} required rows={3} value={body} /></label>{eventType !== "DIRECT" ? <label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Referência da publicação fictícia</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" maxLength={500} onChange={(event) => setPublicationReference(event.target.value)} placeholder="post-local-001" required value={publicationReference} /></label> : null}<div className="flex flex-wrap items-center gap-2 md:col-span-2"><Button disabled={pending || !body.trim() || !username.trim() || (eventType !== "DIRECT" && !publicationReference.trim())} type="submit">{pending ? "Registrando…" : "Registrar fixture local"}</Button><Button asChild variant="secondary"><Link href="/inbox?channels=INSTAGRAM_MESSAGING">Abrir no inbox</Link></Button></div></form></Surface>

      <Surface tone="subtle"><SectionHeader title="Gates do canal" description="Cada capacidade separa prova local de evidência do provider." /><div className="mt-4 space-y-3">{initial.readiness.map((item) => <article className="rounded-[var(--radius-control)] border border-border bg-card p-3" key={item.key}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.key.replaceAll("_", " ")}</strong><span className="status-badge" data-tone={item.status === "VALIDATED_LOCALLY" ? "success" : item.status === "EXTERNAL_BLOCKED" ? "danger" : "warning"}>{readinessLabels[item.status]}</span></div><p className="mt-2 text-sm text-muted-foreground">{item.detail}</p></article>)}</div></Surface>
    </div>

    <Surface><SectionHeader title="Fixtures recentes" description="Eventos locais são idempotentes e apontam para a mensagem criada no inbox." />{initial.recent.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Evento</th><th>Estado</th><th>Mensagem</th><th>Recebido em</th></tr></thead><tbody>{initial.recent.map((item) => <tr key={item.id}><td className="font-mono text-xs">{item.providerEventId}</td><td><span className="status-badge" data-tone={item.status === "PROCESSED" ? "success" : "warning"}>{item.status}</span></td><td className="font-mono text-xs">{item.messageId ?? "Sem mensagem"}</td><td>{formatDate(item.receivedAt)}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma fixture do Instagram registrada.</p>}</Surface>
  </div>;
}
