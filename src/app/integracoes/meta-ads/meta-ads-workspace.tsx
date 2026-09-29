"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getMetaAdsService } from "@/modules/integrations/application/meta-ads-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getMetaAdsService>["screen"]>>;
const statusLabels: Record<string, string> = { NOT_CONFIGURED: "Não configurada", PENDING_CREDENTIALS: "Aguardando credenciais", DRAFT: "Pronta para teste", CONNECTED: "Conectada", PAUSED: "Pausada", SYNCING: "Sincronizando", STALE: "Desatualizada", NEEDS_ATTENTION: "Requer atenção", DEGRADED: "Degradada", CONFIG_ERROR: "Erro de configuração", REVOKED: "Revogada", DECOMMISSIONED: "Desativada" };

export function MetaAdsWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(initial.config?.selectedAccountIds ?? []);
  const [initialSince, setInitialSince] = useState(initial.config?.initialSince ?? initial.suggestedInitialSince);
  const [lookbackDays, setLookbackDays] = useState(initial.config?.lookbackDays ?? 7);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function post(action: string, body: unknown) {
    setPending(action); setFeedback(null);
    const response = await fetch("/api/integrations/meta-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json(); setPending(null);
    if (!response.ok) { setFeedback(payload.error?.message ?? "A operação Meta não foi concluída."); return null; }
    router.refresh(); return payload.result;
  }

  async function configure() {
    const result = await post("CONFIGURE", { action: "CONFIGURE", data: { displayName: "Meta Ads", ...(initial.connection ? { revision: initial.connection.revision } : {}), config: { graphApiVersion: initial.config?.graphApiVersion ?? "v26.0", selectedAccountIds, initialSince, lookbackDays, pageSize: 100, requestTimeoutMs: 12_000 } } });
    if (result) setFeedback(result.credentialsPending ? "Configuração versionada. Aguardando a referência server-side do token Meta." : "Configuração versionada. Execute o teste de conexão antes da sincronização.");
  }

  async function testConnection() {
    const result = await post("TEST_CONNECTION", { action: "TEST_CONNECTION" });
    if (result) setFeedback(`Conexão somente leitura validada. ${result.accessibleAccounts.length} conta(s) acessível(is).`);
  }

  async function sync(mode: "INITIAL" | "INCREMENTAL") {
    const result = await post(`SYNC_${mode}`, { action: "RUN_SYNC", mode, correlationId: `meta-${crypto.randomUUID()}` });
    if (result) setFeedback(`Sincronização ${mode === "INITIAL" ? "inicial" : "incremental"} concluída e auditada.`);
  }

  async function pauseOrResume() {
    if (!initial.connection) return;
    const paused = initial.readiness === "PAUSED";
    const result = await post(paused ? "RESUME" : "PAUSE", { action: paused ? "RESUME" : "PAUSE", revision: initial.connection.revision });
    if (result) setFeedback(paused ? "Conexão retomada." : "Conexão pausada. Nenhuma nova coleta será iniciada.");
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const connected = initial.readiness === "CONNECTED";
  return <div className="space-y-5">
    <Surface tone={connected ? "accent" : "critical"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader title={connected ? "Coleta Meta disponível" : "Integração aguardando configuração segura"} description="Somente GET em rotas oficiais allowlisted. O conector não cria campanhas, não altera leads e não atribui vendas automaticamente." />
        <span className="status-badge" data-tone={connected ? "success" : "warning"}>{statusLabels[initial.readiness] ?? initial.readiness}</span>
      </div>
      {initial.missingInformation.length ? <ul className="mt-3 list-disc pl-5 text-sm">{initial.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    </Surface>

    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label="Contas descobertas" value={initial.accounts.length} hint="IDs exatos retornados pela Meta" />
      <StatCard label="Contas selecionadas" value={selectedAccountIds.length} hint="Escopo explícito da coleta" />
      <StatCard label="Execuções" value={initial.runs.length} hint="Histórico persistido recente" />
    </div>

    {feedback ? <p className="feedback-banner" role="status">{feedback}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <Surface>
        <SectionHeader title="Configuração de leitura" description="Versão da API, contas e janela são versionadas. Valores secretos nunca passam por este formulário." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="font-semibold">Versão Graph API</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" readOnly value={initial.config?.graphApiVersion ?? "v26.0"} /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Data inicial</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" type="date" value={initialSince} onChange={(event) => setInitialSince(event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Releitura incremental</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}><option value={3}>3 dias</option><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={28}>28 dias</option></select></label>
        </div>
        <fieldset className="mt-5"><legend className="font-semibold">Contas autorizadas para coleta</legend>{initial.accounts.length ? <div className="mt-3 space-y-2">{initial.accounts.map((account) => <label className="flex items-start gap-3 rounded-[var(--radius-control)] bg-muted/50 p-3" key={account.id}><input checked={selectedAccountIds.includes(account.key)} className="mt-1" type="checkbox" onChange={() => toggleAccount(account.key)} /><span><strong className="block">{account.name}</strong><span className="text-sm text-muted-foreground">{account.key} · {account.currency} · {account.timeZone}</span></span></label>)}</div> : <p className="mt-2 text-sm text-muted-foreground">As contas aparecem aqui somente depois de um teste real bem-sucedido.</p>}</fieldset>
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={pending !== null} onClick={configure}>{pending === "CONFIGURE" ? "Salvando…" : "Salvar configuração"}</Button><Button disabled={pending !== null || !initial.connection} onClick={testConnection} variant="secondary">Testar conexão</Button>{initial.connection ? <Button disabled={pending !== null} onClick={pauseOrResume} variant="secondary">{initial.readiness === "PAUSED" ? "Retomar" : "Pausar"}</Button> : null}</div>
      </Surface>

      <Surface tone="subtle">
        <SectionHeader title="Credenciais e segurança" description="O banco armazena somente referências fixas. O processo do servidor resolve os valores no ambiente." />
        <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>Token de acesso</dt><dd className="font-semibold">{initial.connection?.credentials.accessTokenReferencePresent ? "Referência disponível" : "Pendente"}</dd></div><div className="flex justify-between gap-3"><dt>App secret</dt><dd className="font-semibold">{initial.connection?.credentials.appSecretReferencePresent ? "Referência disponível" : "Opcional / pendente"}</dd></div><div className="flex justify-between gap-3"><dt>Validação externa</dt><dd className="font-semibold">{initial.externalValidation ? "Executada" : "Não executada"}</dd></div></dl>
        <p className="mt-4 text-sm text-muted-foreground">Nunca cole token ou app secret nesta tela. Configure-os somente no ambiente local do servidor e reinicie a aplicação.</p>
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={!connected || selectedAccountIds.length === 0 || pending !== null} onClick={() => sync("INITIAL")}>Sincronização inicial</Button><Button disabled={!connected || selectedAccountIds.length === 0 || pending !== null} onClick={() => sync("INCREMENTAL")} variant="secondary">Sincronização incremental</Button></div>
      </Surface>
    </div>

    <Surface>
      <SectionHeader title="Execuções de leitura" description="Cursor só avança no mesmo commit dos fatos. Falhas preservam a janela anterior e ficam classificadas." />
      {initial.runs.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Modo</th><th>Status</th><th>Janela</th><th>Lidos</th><th>Criados</th><th>Atualizados</th><th>Ignorados</th></tr></thead><tbody>{initial.runs.map((run) => <tr key={run.id}><td>{run.executionMode}</td><td>{run.status}</td><td>{run.windowStart?.slice(0, 10) ?? "—"} → {run.windowEnd?.slice(0, 10) ?? "—"}</td><td>{run.readCount}</td><td>{run.createdCount}</td><td>{run.updatedCount}</td><td>{run.ignoredCount}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma sincronização executada.</p>}
    </Surface>
  </div>;
}
