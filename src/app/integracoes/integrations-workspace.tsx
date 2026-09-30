"use client";
import Link from "next/link";
import styles from "./integrations.module.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, Surface, StatCard } from "@/components/ui/surface";

type Connection = Readonly<{ id: string; displayName: string; providerKey: string; adapterKey: string; environment: string; status: string; capabilityLevel: string; revision: number; enabled: boolean; lastTestedAt: string | null; capabilities: readonly string[]; error: { message: string } | null }>;
type Initial = Readonly<{ capabilityCeiling: "VALIDATED_LOCALLY"; externalEgress: boolean; generatedAt: string; summary: Record<string, number>; connections: readonly Connection[] }>;
const labels: Record<string, string> = { IMPLEMENTED: "Implementada", VALIDATED_LOCALLY: "Validada localmente", READY_FOR_LOCAL_TEST: "Pronta para teste local", ACTIVE_LOCAL: "Ativa somente local", PAUSED: "Pausada", DEGRADED: "Degradada", CONFIG_ERROR: "Erro de configuração" };

export function IntegrationsWorkspace({ initial }: Readonly<{ initial: Initial }>) {
  const router = useRouter(); const [pending, setPending] = useState<string | null>(null); const [feedback, setFeedback] = useState<string | null>(null);
  async function command(connection: Connection, action: "TEST" | "PAUSE" | "ACTIVATE_LOCAL" | "RUN_SYNC") {
    setPending(`${connection.id}:${action}`); setFeedback(null);
    const data = action === "RUN_SYNC" ? { action, connectionId: connection.id, direction: "PULL", objectType: "lead", correlationId: `ui-${connection.id}-${connection.revision}` } : action === "TEST" ? { action, connectionId: connection.id } : { action, connectionId: connection.id, revision: connection.revision };
    const response = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "COMMAND", data }) });
    const body = await response.json(); setPending(null);
    if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível concluir a operação local."); return; }
    setFeedback(action === "TEST" ? "Contrato validado localmente, sem egress externo." : "Operação local concluída e auditada."); router.refresh();
  }
  return <div className={styles.workspace}>
    <Surface tone="accent"><SectionHeader title="Ambiente de testes locais" description="As conexões abaixo permitem validar os fluxos sem enviar dados para os provedores. A configuração de cada canal informa os requisitos para ativação externa." /></Surface>
    <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Conexões" value={initial.connections.length} hint="Persistidas por workspace" /><StatCard label="Ativas localmente" value={initial.summary.ACTIVE_LOCAL ?? 0} hint="Sem egress de rede" /><StatCard label="Capacidade externa" value="0" hint="Conexões externas ativas" /></div>
    {feedback ? <p className="feedback-banner" role="status">{feedback}</p> : null}
    <div className={styles.connections}>{initial.connections.length === 0 ? <EmptyState title="Nenhuma conexão configurada" description="Selecione um canal acima para consultar as opções de configuração." /> : initial.connections.map((connection) => <Surface key={connection.id}>
      <div className={styles.connectionHead}><span className={styles.provider}>{connection.displayName.slice(0, 1)}</span><div><h2>{connection.displayName}</h2><p>{labels[connection.capabilityLevel] ?? connection.capabilityLevel}</p></div><span className="status-badge" data-tone={connection.error ? "danger" : connection.enabled ? "success" : "default"}>{labels[connection.status] ?? connection.status}</span></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Ambiente</dt><dd>{connection.environment === "LOCAL" ? "Local" : connection.environment}</dd></div><div><dt className="text-muted-foreground">Capacidade</dt><dd>{labels[connection.capabilityLevel] ?? connection.capabilityLevel}</dd></div><div><dt className="text-muted-foreground">Último teste</dt><dd>{connection.lastTestedAt ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(connection.lastTestedAt)) : "Ainda não executado"}</dd></div></dl>
      <p className="mt-3 text-sm text-muted-foreground">{connection.capabilities.join(" · ")}</p>{connection.error ? <p className="mt-3 text-sm text-red-700">Falha controlada: {connection.error.message}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={pending !== null} onClick={() => command(connection, "TEST")}>{pending === `${connection.id}:TEST` ? "Testando…" : "Testar localmente"}</Button>{connection.enabled ? <Button variant="secondary" disabled={pending !== null} onClick={() => command(connection, "RUN_SYNC")}>Executar sync local</Button> : null}<Button variant="secondary" disabled={pending !== null} onClick={() => command(connection, connection.enabled ? "PAUSE" : "ACTIVATE_LOCAL")}>{connection.enabled ? "Pausar" : "Ativar local"}</Button>{connection.providerKey === "EMAIL_LOCAL_SINK" ? <Button asChild variant="secondary"><Link href="/integracoes/email">Abrir canal de e-mail</Link></Button> : connection.providerKey === "WHATSAPP_CLOUD_API" ? <Button asChild variant="secondary"><Link href="/integracoes/whatsapp">Abrir WhatsApp</Link></Button> : connection.providerKey === "CALENDAR_LOCAL_SANDBOX" ? <Button asChild variant="secondary"><Link href="/integracoes/calendario">Abrir calendário</Link></Button> : null}</div>
      <details className="mt-4 rounded-[var(--radius-control)] bg-muted/50 p-3"><summary className="cursor-pointer font-semibold">Detalhes técnicos progressivos</summary><p className="mt-2 text-sm text-muted-foreground">Inbox assinada, outbox transacional, tentativas append-only, cursor commit-safe e mapeamentos com precedência humana. Nenhum endpoint arbitrário é aceito.</p></details>
    </Surface>)}</div>
  </div>;
}
