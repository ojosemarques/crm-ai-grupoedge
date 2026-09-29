import { createHmac } from "node:crypto";
import { z, type ZodType } from "zod";
import {
  META_ADS_ACCESS_TOKEN_ALIAS,
  META_ADS_ADAPTER_KEY,
  META_ADS_APP_SECRET_ALIAS,
  META_ADS_MAX_RESPONSE_BYTES,
  META_ADS_PROVIDER_KEY,
  metaAdsAccountSchema,
  metaAdsAdSchema,
  metaAdsAdSetSchema,
  metaAdsCampaignSchema,
  metaAdsConfigurationSchema,
  metaAdsIdentitySchema,
  metaAdsInsightSchema,
  metaGraphErrorSchema,
  type MetaAdsAccount,
  type MetaAdsAd,
  type MetaAdsAdSet,
  type MetaAdsCampaign,
  type MetaAdsConfiguration,
  type MetaAdsFailure,
  type MetaAdsIdentity,
  type MetaAdsInsight,
} from "@/modules/integrations/domain/meta-ads-contracts";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const RETRYABLE = new Set<MetaAdsFailure["classification"]>(["TRANSIENT", "RATE_LIMIT"]);
const graphPageSchema = z.object({
  data: z.array(z.unknown()),
  paging: z.object({ cursors: z.object({ after: z.string().max(2_000).optional() }).passthrough().optional() }).passthrough().optional(),
}).passthrough();

export class MetaAdsAdapterError extends Error {
  constructor(readonly failure: MetaAdsFailure) {
    super(failure.safeMessage);
    this.name = "MetaAdsAdapterError";
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Options = Readonly<{
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}>;

export type MetaAdsCredentials = Readonly<{ accessToken: string; appSecret?: string | null }>;
export type MetaAdsHierarchy = Readonly<{
  accounts: readonly MetaAdsAccount[];
  campaigns: readonly MetaAdsCampaign[];
  adSets: readonly MetaAdsAdSet[];
  ads: readonly MetaAdsAd[];
}>;
export type MetaAdsSyncPayload = Readonly<{
  hierarchy: MetaAdsHierarchy;
  insights: readonly MetaAdsInsight[];
  requestCount: number;
}>;

function safeRetryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Math.min(Number(value), 300);
}

function failureFromResponse(response: Response, payload: unknown): MetaAdsFailure {
  const parsed = metaGraphErrorSchema.safeParse(payload);
  const code = parsed.success ? parsed.data.error.code : undefined;
  const subcode = parsed.success ? parsed.data.error.error_subcode : undefined;
  const transient = parsed.success && parsed.data.error.is_transient === true;
  const suffix = [response.status, code, subcode].filter((part) => part !== undefined).join("_");
  if (response.status === 401 || code === 190) return { classification: "AUTHENTICATION", code: `META_AUTH_${suffix}`, safeMessage: "A credencial Meta não foi aceita ou expirou." };
  if (response.status === 429 || [4, 17, 32, 613].includes(code ?? -1)) {
    const retryAfterSeconds = safeRetryAfter(response);
    return { classification: "RATE_LIMIT", code: `META_RATE_LIMIT_${suffix}`, safeMessage: "A Meta limitou temporariamente as consultas. A sincronização pode ser repetida com segurança.", ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  }
  if (response.status === 403 || [10, 200, 294].includes(code ?? -1)) return { classification: "PERMISSION", code: `META_PERMISSION_${suffix}`, safeMessage: "A credencial não possui permissão de leitura suficiente para esta conta Meta." };
  if (response.status === 404) return { classification: "ACCOUNT_INACCESSIBLE", code: `META_ACCOUNT_${suffix}`, safeMessage: "A conta de anúncios selecionada não está acessível para esta credencial." };
  if (response.status >= 500 || transient) return { classification: "TRANSIENT", code: `META_TRANSIENT_${suffix}`, safeMessage: "A Meta apresentou uma falha transitória. Nenhum cursor foi avançado." };
  if (response.status >= 400) return { classification: "PERMANENT", code: `META_REQUEST_${suffix}`, safeMessage: "A Meta rejeitou a consulta de leitura. Revise versão, conta e permissões." };
  return { classification: "INVALID_PAYLOAD", code: "META_INVALID_RESPONSE", safeMessage: "A Meta retornou um contrato inesperado. Nenhum dado foi persistido." };
}

function pathAllowed(path: string): boolean {
  return path === "/me" || path === "/me/adaccounts" || /^\/act_[0-9]{3,40}(?:\/(campaigns|adsets|ads|insights))?$/.test(path);
}

export class MetaAdsReadAdapter {
  readonly providerKey = META_ADS_PROVIDER_KEY;
  readonly adapterKey = META_ADS_ADAPTER_KEY;
  readonly capability = "SYNC_PULL" as const;
  readonly #fetcher: Fetcher;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: Options = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#random = options.random ?? Math.random;
  }

  validateConfiguration(input: unknown): MetaAdsConfiguration {
    return metaAdsConfigurationSchema.parse(input);
  }

  classifyError(error: unknown): MetaAdsFailure {
    if (error instanceof MetaAdsAdapterError) return error.failure;
    if (error instanceof z.ZodError) return { classification: "INVALID_PAYLOAD", code: "META_INVALID_PAYLOAD", safeMessage: "A Meta retornou dados fora do contrato esperado. Nenhum dado foi persistido." };
    if (error instanceof DOMException && error.name === "AbortError") return { classification: "TRANSIENT", code: "META_TIMEOUT", safeMessage: "A consulta à Meta excedeu o tempo seguro. Nenhum cursor foi avançado." };
    return { classification: "INTERNAL", code: "META_INTERNAL", safeMessage: "A sincronização Meta falhou de forma controlada." };
  }

  async #request(config: MetaAdsConfiguration, credentials: MetaAdsCredentials, path: string, params: Readonly<Record<string, string>>, attempt = 1): Promise<unknown> {
    if (!pathAllowed(path)) throw new MetaAdsAdapterError({ classification: "CONFIGURATION", code: "META_PATH_REJECTED", safeMessage: "A rota Meta solicitada não pertence à allowlist de leitura." });
    const url = new URL(`${GRAPH_ORIGIN}/${config.graphApiVersion}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (credentials.appSecret) url.searchParams.set("appsecret_proof", createHmac("sha256", credentials.appSecret).update(credentials.accessToken).digest("hex"));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await this.#fetcher(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > META_ADS_MAX_RESPONSE_BYTES) throw new MetaAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "META_RESPONSE_TOO_LARGE", safeMessage: "A resposta Meta excedeu o limite seguro e foi rejeitada." });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > META_ADS_MAX_RESPONSE_BYTES) throw new MetaAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "META_RESPONSE_TOO_LARGE", safeMessage: "A resposta Meta excedeu o limite seguro e foi rejeitada." });
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch { throw new MetaAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "META_INVALID_JSON", safeMessage: "A Meta retornou conteúdo que não é JSON válido." }); }
      if (!response.ok || metaGraphErrorSchema.safeParse(payload).success) {
        const failure = failureFromResponse(response, payload);
        if (attempt < 3 && RETRYABLE.has(failure.classification)) {
          const base = (failure.retryAfterSeconds ?? 2 ** (attempt - 1)) * 1_000;
          await this.#sleep(Math.min(30_000, Math.round(base + base * 0.2 * this.#random())));
          return this.#request(config, credentials, path, params, attempt + 1);
        }
        throw new MetaAdsAdapterError(failure);
      }
      return payload;
    } finally { clearTimeout(timeout); }
  }

  async #all<T>(config: MetaAdsConfiguration, credentials: MetaAdsCredentials, path: string, fields: string, schema: ZodType<T>, extra: Readonly<Record<string, string>> = {}): Promise<{ rows: T[]; requests: number }> {
    const rows: T[] = [];
    let after: string | undefined;
    let requests = 0;
    do {
      const payload = await this.#request(config, credentials, path, { fields, limit: String(config.pageSize), ...extra, ...(after ? { after } : {}) });
      requests += 1;
      const page = graphPageSchema.parse(payload);
      for (const row of page.data) rows.push(schema.parse(row));
      const next = page.paging?.cursors?.after;
      if (next && next === after) throw new MetaAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "META_CURSOR_LOOP", safeMessage: "A paginação Meta repetiu o mesmo cursor e foi interrompida." });
      after = next;
    } while (after);
    return { rows, requests };
  }

  async testConnection(config: MetaAdsConfiguration, credentials: MetaAdsCredentials): Promise<{ identity: MetaAdsIdentity; accounts: readonly MetaAdsAccount[]; requestCount: number }> {
    const identity = metaAdsIdentitySchema.parse(await this.#request(config, credentials, "/me", { fields: "id,name" }));
    const accounts = await this.#all(config, credentials, "/me/adaccounts", "id,account_id,name,account_status,currency,timezone_name", metaAdsAccountSchema);
    return { identity, accounts: accounts.rows, requestCount: accounts.requests + 1 };
  }

  async pull(config: MetaAdsConfiguration, credentials: MetaAdsCredentials, window: Readonly<{ since: string; until: string }>): Promise<MetaAdsSyncPayload> {
    const accounts: MetaAdsAccount[] = [];
    const campaigns: MetaAdsCampaign[] = [];
    const adSets: MetaAdsAdSet[] = [];
    const ads: MetaAdsAd[] = [];
    const insights: MetaAdsInsight[] = [];
    let requestCount = 0;
    for (const accountId of config.selectedAccountIds) {
      const account = metaAdsAccountSchema.parse(await this.#request(config, credentials, `/${accountId}`, { fields: "id,account_id,name,account_status,currency,timezone_name" }));
      const campaignPage = await this.#all(config, credentials, `/${accountId}/campaigns`, "id,account_id,name,status,start_time,stop_time", metaAdsCampaignSchema);
      const adSetPage = await this.#all(config, credentials, `/${accountId}/adsets`, "id,campaign_id,name,status", metaAdsAdSetSchema);
      const adPage = await this.#all(config, credentials, `/${accountId}/ads`, "id,adset_id,name,status,creative{id,name}", metaAdsAdSchema);
      const insightPage = await this.#all(config, credentials, `/${accountId}/insights`, "account_id,account_name,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values", metaAdsInsightSchema, { level: "ad", time_increment: "1", time_range: JSON.stringify({ since: window.since, until: window.until }) });
      requestCount += campaignPage.requests + adSetPage.requests + adPage.requests + insightPage.requests + 1;
      campaigns.push(...campaignPage.rows); adSets.push(...adSetPage.rows); ads.push(...adPage.rows); insights.push(...insightPage.rows);
      accounts.push(account);
    }
    return { hierarchy: { accounts, campaigns, adSets, ads }, insights, requestCount };
  }
}

export const metaAdsReadAdapter = new MetaAdsReadAdapter();

export function metaAdsSecretAliases() {
  return Object.freeze([META_ADS_ACCESS_TOKEN_ALIAS, META_ADS_APP_SECRET_ALIAS]);
}
