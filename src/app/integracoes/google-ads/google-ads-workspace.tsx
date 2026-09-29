"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import type { getGoogleAdsService } from "@/modules/integrations/application/google-ads-service";

type Screen = Awaited<ReturnType<ReturnType<typeof getGoogleAdsService>["screen"]>>;

const statusLabels: Record<string, string> = {
  NOT_CONFIGURED: "Não configurada",
  EXTERNAL_VALIDATION_DEFERRED: "Validação externa adiada",
  AWAITING_CREDENTIAL: "Aguardando referências",
  DRAFT: "Pronta para teste",
  CONNECTED: "Conectada",
  PAUSED: "Pausada",
  SYNCING: "Sincronizando",
  NEEDS_ATTENTION: "Requer atenção",
  DEGRADED: "Degradada",
  CONFIG_ERROR: "Erro de configuração",
};

export function GoogleAdsWorkspace({ initial }: Readonly<{ initial: Screen }>) {
  const router = useRouter();
  const [authStrategy, setAuthStrategy] = useState<"SERVICE_ACCOUNT" | "OAUTH_REFRESH_TOKEN">(initial.config?.authStrategy ?? "SERVICE_ACCOUNT");
  const [loginCustomerId, setLoginCustomerId] = useState(initial.config?.loginCustomerId ?? "");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>(initial.config?.selectedCustomerIds ?? []);
  const [initialSince, setInitialSince] = useState(initial.config?.initialSince ?? initial.suggestedInitialSince);
  const [lookbackDays, setLookbackDays] = useState(initial.config?.lookbackDays ?? 7);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function post(action: string, body: unknown) {
    setPending(action);
    setFeedback(null);
    const response = await fetch("/api/integrations/google-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    setPending(null);
    if (!response.ok) {
      setFeedback(payload.error?.message ?? "A operação Google Ads não foi concluída.");
      return null;
    }
    router.refresh();
    return payload.result;
  }

  async function configure() {
    const result = await post("CONFIGURE", {
      action: "CONFIGURE",
      data: {
        displayName: "Google Ads",
        ...(initial.connection ? { revision: initial.connection.revision } : {}),
        config: {
          apiVersion: initial.config?.apiVersion ?? "v25",
          authStrategy,
          loginCustomerId: loginCustomerId.replaceAll("-", "").trim() || null,
          selectedCustomerIds,
          initialSince,
          lookbackDays,
          pageSize: 10_000,
          requestTimeoutMs: 12_000,
        },
      },
    });
    if (result) setFeedback(result.credentialsPending ? "Configuração versionada. A validação externa permanece adiada até as referências server-side existirem." : "Configuração versionada. Execute o teste externo somente quando houver autorização futura.");
  }

  async function testConnection() {
    const result = await post("TEST_CONNECTION", { action: "TEST_CONNECTION" });
    if (result) setFeedback(`Conexão somente leitura validada. ${result.accessibleCustomers.length} customer(s) acessível(is).`);
  }

  async function sync(mode: "INITIAL" | "INCREMENTAL") {
    const result = await post(`SYNC_${mode}`, { action: "RUN_SYNC", mode, correlationId: `google-${crypto.randomUUID()}` });
    if (result) setFeedback(`Sincronização ${mode === "INITIAL" ? "inicial" : "incremental"} concluída e auditada.`);
  }

  async function pauseOrResume() {
    if (!initial.connection) return;
    const paused = initial.readiness === "PAUSED";
    const result = await post(paused ? "RESUME" : "PAUSE", { action: paused ? "RESUME" : "PAUSE", revision: initial.connection.revision });
    if (result) setFeedback(paused ? "Conexão retomada." : "Conexão pausada. Nenhuma nova coleta será iniciada.");
  }

  function toggleCustomer(id: string) {
    setSelectedCustomerIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const connected = initial.readiness === "CONNECTED";
  return <div className="space-y-5">
    <Surface tone={connected ? "accent" : "critical"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader title={connected ? "Coleta Google Ads disponível" : "Validação externa adiada"} description="A implementação foi validada localmente com contratos, fixtures e falhas determinísticas. Nenhuma credencial real foi solicitada ou utilizada." />
        <span className="status-badge" data-tone={connected ? "success" : "warning"}>{statusLabels[initial.readiness] ?? initial.readiness}</span>
      </div>
      {initial.missingInformation.length ? <ul className="mt-3 list-disc pl-5 text-sm">{initial.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    </Surface>

    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label="Customers descobertos" value={initial.accounts.length} hint="IDs exatos retornados pelo Google" />
      <StatCard label="Customers selecionados" value={selectedCustomerIds.length} hint="Escopo explícito da coleta" />
      <StatCard label="Execuções" value={initial.runs.length} hint="Histórico persistido recente" />
    </div>

    {feedback ? <p className="feedback-banner" role="status">{feedback}</p> : null}

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <Surface>
        <SectionHeader title="Configuração somente leitura" description="API, estratégia, customer gestor, contas e janela são versionados. Valores secretos não passam pelo navegador." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="font-semibold">Versão Google Ads API</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" readOnly value={initial.config?.apiVersion ?? "v25"} /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Estratégia de autenticação</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" value={authStrategy} onChange={(event) => setAuthStrategy(event.target.value as typeof authStrategy)}><option value="SERVICE_ACCOUNT">Service account</option><option value="OAUTH_REFRESH_TOKEN">OAuth com refresh token</option></select></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Customer gestor (opcional)</span><input aria-describedby="google-login-customer-help" className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" inputMode="numeric" placeholder="000-000-0000" value={loginCustomerId} onChange={(event) => setLoginCustomerId(event.target.value)} /><span id="google-login-customer-help" className="block text-xs text-muted-foreground">Somente o ID. O servidor envia login-customer-id sem hífens.</span></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Data inicial</span><input className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" type="date" value={initialSince} onChange={(event) => setInitialSince(event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">Releitura incremental</span><select className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2" value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}><option value={3}>3 dias</option><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={28}>28 dias</option></select></label>
        </div>
        <fieldset className="mt-5"><legend className="font-semibold">Customers autorizados para coleta</legend>{initial.accounts.length ? <div className="mt-3 space-y-2">{initial.accounts.map((account) => <label className="flex items-start gap-3 rounded-[var(--radius-control)] bg-muted/50 p-3" key={account.id}><input checked={selectedCustomerIds.includes(account.customerId)} className="mt-1" type="checkbox" onChange={() => toggleCustomer(account.customerId)} /><span><strong className="block">{account.name}</strong><span className="text-sm text-muted-foreground">{account.customerId} · {account.currency} · {account.timeZone}</span></span></label>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Os customers aparecem somente após um teste externo bem-sucedido, adiado nesta fase.</p>}</fieldset>
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={pending !== null} onClick={configure}>{pending === "CONFIGURE" ? "Salvando…" : "Salvar configuração"}</Button><Button disabled={pending !== null || !initial.connection} onClick={testConnection} variant="secondary">Testar conexão</Button>{initial.connection ? <Button disabled={pending !== null} onClick={pauseOrResume} variant="secondary">{initial.readiness === "PAUSED" ? "Retomar" : "Pausar"}</Button> : null}</div>
      </Surface>

      <Surface tone="subtle">
        <SectionHeader title="Credenciais e limites" description="O banco armazena referências fixas. A interface não recebe client secret, refresh token, chave privada ou developer token." />
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-3"><dt>Estratégia</dt><dd className="font-semibold">{authStrategy === "SERVICE_ACCOUNT" ? "Service account" : "OAuth refresh token"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Referências necessárias</dt><dd className="font-semibold">{initial.connection && Object.values(initial.connection.credentialReferencesPresent).some(Boolean) ? "Parcialmente disponíveis" : "Pendentes"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Validação externa</dt><dd className="font-semibold">{initial.externalValidationDeferred ? "Adiada" : "Executada"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Escrita no Google Ads</dt><dd className="font-semibold">Não suportada</dd></div>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">Não cole segredos nesta tela. Uma autorização futura deve configurar as referências somente no ambiente server-side e executar o teste real.</p>
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={!connected || selectedCustomerIds.length === 0 || pending !== null} onClick={() => sync("INITIAL")}>Sincronização inicial</Button><Button disabled={!connected || selectedCustomerIds.length === 0 || pending !== null} onClick={() => sync("INCREMENTAL")} variant="secondary">Sincronização incremental</Button></div>
      </Surface>
    </div>

    <Surface>
      <SectionHeader title="Execuções de leitura" description="O cursor só avança no mesmo commit dos fatos. Falhas preservam a janela anterior e registram código seguro e request ID quando disponível." />
      {initial.runs.length ? <DataTableShell className="mt-4"><table><thead><tr><th>Modo</th><th>Status</th><th>Lidos</th><th>Criados</th><th>Atualizados</th><th>Ignorados</th><th>Falha</th></tr></thead><tbody>{initial.runs.map((run) => <tr key={run.id}><td>{run.mode}</td><td>{run.status}</td><td>{run.readCount}</td><td>{run.createdCount}</td><td>{run.updatedCount}</td><td>{run.ignoredCount}</td><td>{run.errorCode ?? "—"}</td></tr>)}</tbody></table></DataTableShell> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma sincronização executada.</p>}
    </Surface>
  </div>;
}
