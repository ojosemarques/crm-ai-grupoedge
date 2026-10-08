"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionHeader, Surface } from "@/components/ui/surface";

type Initial = Readonly<{
  configurationReady: boolean;
  account: null | Readonly<{
    email: string;
    status: "CONNECTED" | "NEEDS_REAUTH" | "DISCONNECTED";
    lastSyncAt: string | null;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
    updatedAt: string;
  }>;
}>;

const statusLabel = { CONNECTED: "Conectado", NEEDS_REAUTH: "Precisa reconectar", DISCONNECTED: "Desconectado" } as const;
function date(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Ainda não executada"; }

export function CalendarWorkspace({ initial, callbackStatus, callbackCode }: Readonly<{ initial: Initial; callbackStatus?: string | undefined; callbackCode?: string | undefined }>) {
  const router = useRouter();
  const [pending, setPending] = useState<"connect" | "disconnect" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(callbackStatus === "connected" ? "Google Calendar conectado com sucesso." : callbackStatus === "error" ? `A conexão não foi concluída (${callbackCode ?? "erro desconhecido"}).` : null);
  async function connect() {
    setPending("connect"); setFeedback(null);
    const response = await fetch("/api/integrations/google-calendar/connect", { method: "POST" });
    const body = await response.json() as { result?: { authorizationUrl?: string }; error?: { message?: string } };
    if (!response.ok || !body.result?.authorizationUrl) { setFeedback(body.error?.message ?? "Não foi possível iniciar a autorização do Google."); setPending(null); return; }
    window.location.assign(body.result.authorizationUrl);
  }
  async function disconnect() {
    setPending("disconnect"); setFeedback(null);
    const response = await fetch("/api/integrations/google-calendar/disconnect", { method: "POST" });
    const body = await response.json() as { error?: { message?: string } };
    setPending(null);
    if (!response.ok) { setFeedback(body.error?.message ?? "Não foi possível desconectar a conta."); return; }
    setFeedback("Conta desconectada. Novas reuniões não serão enviadas ao Google até uma nova autorização."); router.refresh();
  }
  const connected = initial.account?.status === "CONNECTED";
  return <div className="space-y-5">
    {feedback ? <p className="feedback-banner" data-tone={callbackStatus === "error" ? "danger" : "success"} role="status">{feedback}</p> : null}
    <Surface tone="accent"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader title="Google Calendar" description="Cada vendedor conecta a própria conta. As reuniões do CRM são criadas na agenda do responsável e recebem um link do Google Meet." /><span className="status-badge" data-tone={connected ? "success" : initial.configurationReady ? "warning" : "danger"}>{connected ? "Conectado" : initial.configurationReady ? "Aguardando conexão" : "Configuração pendente"}</span></div></Surface>
    <Surface>
      <SectionHeader title="Minha conta Google" description="A autorização é individual. Senha e tokens nunca aparecem na interface; as credenciais ficam cifradas no servidor." />
      {initial.account ? <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Conta</dt><dd className="font-semibold">{initial.account.email}</dd></div><div><dt className="text-muted-foreground">Estado</dt><dd className="font-semibold">{statusLabel[initial.account.status]}</dd></div><div><dt className="text-muted-foreground">Última sincronização</dt><dd className="font-semibold">{date(initial.account.lastSyncAt)}</dd></div><div><dt className="text-muted-foreground">Última falha</dt><dd className="font-semibold">{initial.account.lastErrorCode ?? "Nenhuma"}</dd></div></dl> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma conta conectada para o seu usuário.</p>}
      <div className="mt-5 flex flex-wrap gap-2"><Button disabled={pending !== null || !initial.configurationReady} onClick={() => void connect()}>{pending === "connect" ? "Abrindo Google…" : connected ? "Reconectar Google" : "Conectar Google Calendar"}</Button>{initial.account && initial.account.status !== "DISCONNECTED" ? <Button disabled={pending !== null} onClick={() => void disconnect()} variant="secondary">{pending === "disconnect" ? "Desconectando…" : "Desconectar"}</Button> : null}</div>
      {!initial.configurationReady ? <p className="mt-4 text-sm text-red-700">As variáveis protegidas do Google ainda não foram aplicadas ao ambiente.</p> : null}
    </Surface>
    <Surface tone="subtle"><SectionHeader title="Como funciona" description="O CRM continua sendo a fonte oficial da reunião." /><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground"><li>O SDR ou vendedor agenda a reunião no CRM e escolhe o closer responsável.</li><li>Se o responsável conectou sua conta, o worker cria ou atualiza o evento na agenda dele.</li><li>Remarcações e cancelamentos feitos no CRM são refletidos automaticamente no Google Calendar.</li><li>Administradores e gerentes acompanham as agendas no CRM; vendedores veem apenas o próprio escopo.</li></ol></Surface>
  </div>;
}
