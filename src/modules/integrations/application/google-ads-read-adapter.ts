import { createSign } from "node:crypto";
import { z, type ZodType } from "zod";
import {
  GOOGLE_ADS_MAX_RESPONSE_BYTES,
  GOOGLE_ADS_QUERY_TEMPLATE_VERSION,
  googleAccessibleCustomersSchema,
  googleAdMetricRowSchema,
  googleAdsConfigurationSchema,
  googleAssetRowSchema,
  googleCustomerRowSchema,
  googleErrorSchema,
  googleSearchResponseSchema,
  safeGoogleRequestId,
  type GoogleAdMetricRow,
  type GoogleAdsConfiguration,
  type GoogleAdsFailure,
  type GoogleAssetRow,
  type GoogleCustomerRow,
} from "@/modules/integrations/domain/google-ads-contracts";

const ADS_ORIGIN = "https://googleads.googleapis.com";
const OAUTH_ORIGIN = "https://oauth2.googleapis.com";
const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const RETRYABLE = new Set<GoogleAdsFailure["classification"]>(["TRANSIENT", "RATE_LIMIT"]);

const GAQL = Object.freeze({
  HIERARCHY: `SELECT customer_client.id, customer_client.client_customer, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.level <= 1`,
  AD_METRICS: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type, ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.resource_name, ad_group_ad.ad.name, ad_group_ad.ad.type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.interactions, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value, metrics.ctr, metrics.average_cpc, metrics.average_cpm FROM ad_group_ad WHERE segments.date BETWEEN @SINCE AND @UNTIL`,
  ASSETS: `SELECT ad_group_ad_asset_view.resource_name, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, ad_group_ad_asset_view.enabled, ad_group_ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.resource_name, asset.id, asset.resource_name, asset.name, asset.type FROM ad_group_ad_asset_view`,
});

export type GoogleAdsQueryTemplate = keyof typeof GAQL;
export type GoogleAdsCredentials = Readonly<{
  strategy: "SERVICE_ACCOUNT" | "OAUTH_REFRESH_TOKEN";
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  developerToken?: string | null;
}>;
export type GoogleAdsDiscovery = Readonly<{ accessibleCustomerIds: readonly string[]; hierarchy: readonly GoogleCustomerRow[]; requestIds: readonly string[] }>;
export type GoogleAdsSyncPayload = Readonly<{ rows: readonly GoogleAdMetricRow[]; assets: readonly GoogleAssetRow[]; requestIds: readonly string[]; queryTemplateVersion: string; requestCount: number }>;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Options = Readonly<{ fetcher?: Fetcher; sleep?: (milliseconds: number) => Promise<void>; random?: () => number; now?: () => Date }>;

export class GoogleAdsAdapterError extends Error {
  constructor(readonly failure: GoogleAdsFailure) { super(failure.safeMessage); this.name = "GoogleAdsAdapterError"; }
}

function base64url(value: string | Buffer): string { return Buffer.from(value).toString("base64url"); }

function serviceAccountAssertion(credentials: GoogleAdsCredentials, now: Date): string {
  if (!credentials.serviceAccountEmail || !credentials.serviceAccountPrivateKey) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_SERVICE_ACCOUNT_INCOMPLETE", safeMessage: "As referências da service account estão incompletas." });
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: credentials.serviceAccountEmail, scope: ADS_SCOPE, aud: `${OAUTH_ORIGIN}/token`, iat: issuedAt, exp: issuedAt + 3_600 }))}`;
  const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
  const privateKey = credentials.serviceAccountPrivateKey.replaceAll("\\n", "\n");
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  return value && /^\d+$/.test(value) ? Math.min(Number(value), 300) : undefined;
}

function classify(response: Response, payload: unknown): GoogleAdsFailure {
  const parsed = googleErrorSchema.safeParse(payload);
  const status = parsed.success ? parsed.data.error.status ?? "" : "";
  const message = parsed.success ? parsed.data.error.message ?? "" : "";
  const requestId = safeGoogleRequestId(response.headers.get("request-id"));
  const signature = `${status} ${message}`.toUpperCase();
  const base = { ...(requestId ? { requestId } : {}) };
  if (response.status === 401 || status === "UNAUTHENTICATED" || signature.includes("OAUTH_TOKEN_REVOKED")) return { ...base, classification: "AUTHENTICATION", code: "GOOGLE_OAUTH_REJECTED", safeMessage: "A autenticação Google foi revogada, expirou ou não possui o escopo Google Ads." };
  if (signature.includes("CLOUD_PROJECT_NOT_APPROVED") || signature.includes("DEVELOPER_TOKEN_NOT_APPROVED")) return { ...base, classification: "PERMISSION", code: "GOOGLE_CLOUD_PROJECT_ACCESS_REQUIRED", safeMessage: "O projeto Google Cloud não possui o nível de acesso necessário para Google Ads." };
  if (signature.includes("LOGIN_CUSTOMER_ID") || signature.includes("INVALID_CUSTOMER_ID")) return { ...base, classification: "ACCOUNT_INACCESSIBLE", code: "GOOGLE_LOGIN_CUSTOMER_INVALID", safeMessage: "O login-customer-id ou customer ID não é acessível para esta credencial." };
  if (signature.includes("QUERY_ERROR") || signature.includes("UNRECOGNIZED_FIELD") || signature.includes("PROHIBITED_FIELD")) return { ...base, classification: "CONFIGURATION", code: "GOOGLE_GAQL_INCOMPATIBLE", safeMessage: "O template GAQL não é compatível com a versão selecionada." };
  if (signature.includes("VERSION") && (signature.includes("SUNSET") || signature.includes("UNSUPPORTED"))) return { ...base, classification: "CONFIGURATION", code: "GOOGLE_API_VERSION_SUNSET", safeMessage: "A versão Google Ads configurada não está mais disponível." };
  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") {
    const retryAfterSeconds = retryAfter(response);
    return {
      ...base,
      classification: "RATE_LIMIT",
      code: "GOOGLE_QUOTA_EXHAUSTED",
      safeMessage: "A cota Google Ads foi temporariamente atingida.",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (response.status === 403 || status === "PERMISSION_DENIED") return { ...base, classification: "PERMISSION", code: "GOOGLE_PERMISSION_DENIED", safeMessage: "A credencial não possui acesso de leitura ao customer solicitado." };
  if (response.status >= 500 || ["UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "UNKNOWN", "ABORTED"].includes(status)) return { ...base, classification: "TRANSIENT", code: "GOOGLE_TRANSIENT", safeMessage: "O Google Ads apresentou uma falha transitória. Nenhum cursor foi avançado." };
  if (response.status >= 400) return { ...base, classification: "PERMANENT", code: "GOOGLE_REQUEST_REJECTED", safeMessage: "O Google Ads rejeitou a consulta de leitura." };
  return { ...base, classification: "INVALID_PAYLOAD", code: "GOOGLE_INVALID_RESPONSE", safeMessage: "O Google Ads retornou um contrato inesperado." };
}

export class GoogleAdsReadAdapter {
  readonly #fetcher: Fetcher; readonly #sleep: (milliseconds: number) => Promise<void>; readonly #random: () => number; readonly #now: () => Date;
  constructor(options: Options = {}) { this.#fetcher = options.fetcher ?? fetch; this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))); this.#random = options.random ?? Math.random; this.#now = options.now ?? (() => new Date()); }

  validateConfiguration(input: unknown) { return googleAdsConfigurationSchema.parse(input); }
  queryTemplate(name: GoogleAdsQueryTemplate, window?: { since: string; until: string }): string {
    if (!(name in GAQL)) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_GAQL_NOT_ALLOWLISTED", safeMessage: "Somente templates GAQL internos podem ser executados." });
    if (name !== "AD_METRICS") return GAQL[name];
    if (!window) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_WINDOW_REQUIRED", safeMessage: "A consulta de métricas exige uma janela válida." });
    return GAQL.AD_METRICS.replace("@SINCE", `'${window.since}'`).replace("@UNTIL", `'${window.until}'`);
  }
  classifyError(error: unknown): GoogleAdsFailure {
    if (error instanceof GoogleAdsAdapterError) return error.failure;
    if (error instanceof z.ZodError) return { classification: "INVALID_PAYLOAD", code: "GOOGLE_INVALID_PAYLOAD", safeMessage: "O Google Ads retornou campos fora do contrato esperado." };
    if (error instanceof DOMException && error.name === "AbortError") return { classification: "TRANSIENT", code: "GOOGLE_TIMEOUT", safeMessage: "A consulta Google Ads excedeu o tempo seguro." };
    return { classification: "INTERNAL", code: "GOOGLE_INTERNAL", safeMessage: "A sincronização Google Ads falhou de forma controlada." };
  }

  async #json(url: URL, init: RequestInit, timeoutMs: number, attempt = 1): Promise<{ payload: unknown; requestId?: string }> {
    if (![ADS_ORIGIN, OAUTH_ORIGIN].includes(url.origin)) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_HOST_REJECTED", safeMessage: "O host solicitado não pertence à allowlist Google." });
    if (url.origin === ADS_ORIGIN && !/^\/v(?:24|25)\/(customers:listAccessibleCustomers|customers\/[0-9]{10}\/googleAds:search)$/.test(url.pathname)) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_PATH_REJECTED", safeMessage: "A rota Google solicitada não pertence à allowlist de leitura." });
    if (url.origin === OAUTH_ORIGIN && url.pathname !== "/token") throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_OAUTH_PATH_REJECTED", safeMessage: "A rota OAuth solicitada não pertence à allowlist." });
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.#fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > GOOGLE_ADS_MAX_RESPONSE_BYTES) throw new GoogleAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "GOOGLE_RESPONSE_TOO_LARGE", safeMessage: "A resposta Google excedeu o limite seguro." });
      const text = await response.text();
      if (Buffer.byteLength(text) > GOOGLE_ADS_MAX_RESPONSE_BYTES) throw new GoogleAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "GOOGLE_RESPONSE_TOO_LARGE", safeMessage: "A resposta Google excedeu o limite seguro." });
      let payload: unknown; try { payload = JSON.parse(text); } catch { throw new GoogleAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "GOOGLE_INVALID_JSON", safeMessage: "O Google retornou conteúdo inválido." }); }
      if (!response.ok || googleErrorSchema.safeParse(payload).success) {
        const failure = classify(response, payload);
        if (attempt < 3 && RETRYABLE.has(failure.classification)) { const base = (failure.retryAfterSeconds ?? 2 ** (attempt - 1)) * 1_000; await this.#sleep(Math.min(30_000, Math.round(base + base * 0.2 * this.#random()))); return this.#json(url, init, timeoutMs, attempt + 1); }
        throw new GoogleAdsAdapterError(failure);
      }
      const requestId = safeGoogleRequestId(response.headers.get("request-id"));
      return { payload, ...(requestId ? { requestId } : {}) };
    } finally { clearTimeout(timeout); }
  }

  async #accessToken(config: GoogleAdsConfiguration, credentials: GoogleAdsCredentials): Promise<string> {
    const body = new URLSearchParams();
    if (credentials.strategy === "OAUTH_REFRESH_TOKEN") {
      if (!credentials.oauthClientId || !credentials.oauthClientSecret || !credentials.oauthRefreshToken) throw new GoogleAdsAdapterError({ classification: "CONFIGURATION", code: "GOOGLE_OAUTH_REFERENCES_INCOMPLETE", safeMessage: "As referências OAuth estão incompletas." });
      body.set("client_id", credentials.oauthClientId); body.set("client_secret", credentials.oauthClientSecret); body.set("refresh_token", credentials.oauthRefreshToken); body.set("grant_type", "refresh_token");
    } else { body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"); body.set("assertion", serviceAccountAssertion(credentials, this.#now())); }
    const { payload } = await this.#json(new URL(`${OAUTH_ORIGIN}/token`), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, config.requestTimeoutMs);
    return z.object({ access_token: z.string().min(10), token_type: z.literal("Bearer"), expires_in: z.number().positive().optional() }).passthrough().parse(payload).access_token;
  }

  async #adsRequest(config: GoogleAdsConfiguration, credentials: GoogleAdsCredentials, accessToken: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;
    if (credentials.developerToken) headers["developer-token"] = credentials.developerToken;
    return this.#json(new URL(`${ADS_ORIGIN}/${config.apiVersion}${path}`), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, config.requestTimeoutMs);
  }

  async #search<T>(config: GoogleAdsConfiguration, credentials: GoogleAdsCredentials, accessToken: string, customerId: string, template: GoogleAdsQueryTemplate, schema: ZodType<T>, window?: { since: string; until: string }) {
    const rows: T[] = []; const requestIds: string[] = []; let pageToken: string | undefined; let requests = 0;
    do {
      const { payload, requestId } = await this.#adsRequest(config, credentials, accessToken, `/customers/${customerId}/googleAds:search`, { query: this.queryTemplate(template, window), pageSize: config.pageSize, ...(pageToken ? { pageToken } : {}) });
      requests += 1; if (requestId) requestIds.push(requestId);
      const page = googleSearchResponseSchema.parse(payload); for (const row of page.results) rows.push(schema.parse(row));
      if (page.nextPageToken && page.nextPageToken === pageToken) throw new GoogleAdsAdapterError({ classification: "INVALID_PAYLOAD", code: "GOOGLE_PAGE_TOKEN_LOOP", safeMessage: "A paginação Google repetiu o token e foi interrompida." });
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { rows, requestIds, requests };
  }

  async discover(config: GoogleAdsConfiguration, credentials: GoogleAdsCredentials): Promise<GoogleAdsDiscovery> {
    const accessToken = await this.#accessToken(config, credentials);
    const accessible = await this.#adsRequest(config, credentials, accessToken, "/customers:listAccessibleCustomers");
    const parsed = googleAccessibleCustomersSchema.parse(accessible.payload);
    const ids = parsed.resourceNames.map((name) => name.split("/")[1]!);
    const seeds = config.loginCustomerId ? [config.loginCustomerId] : ids;
    const hierarchy: GoogleCustomerRow[] = []; const requestIds = accessible.requestId ? [accessible.requestId] : [];
    for (const id of seeds) { const page = await this.#search(config, credentials, accessToken, id, "HIERARCHY", googleCustomerRowSchema); hierarchy.push(...page.rows); requestIds.push(...page.requestIds); }
    return { accessibleCustomerIds: ids, hierarchy, requestIds };
  }

  async pull(config: GoogleAdsConfiguration, credentials: GoogleAdsCredentials, window: { since: string; until: string }): Promise<GoogleAdsSyncPayload> {
    const accessToken = await this.#accessToken(config, credentials); const rows: GoogleAdMetricRow[] = []; const assets: GoogleAssetRow[] = []; const requestIds: string[] = []; let requestCount = 1;
    for (const customerId of config.selectedCustomerIds) {
      const metrics = await this.#search(config, credentials, accessToken, customerId, "AD_METRICS", googleAdMetricRowSchema, window);
      const assetRows = await this.#search(config, credentials, accessToken, customerId, "ASSETS", googleAssetRowSchema);
      rows.push(...metrics.rows); assets.push(...assetRows.rows); requestIds.push(...metrics.requestIds, ...assetRows.requestIds); requestCount += metrics.requests + assetRows.requests;
    }
    return { rows, assets, requestIds, requestCount, queryTemplateVersion: GOOGLE_ADS_QUERY_TEMPLATE_VERSION };
  }
}

export const googleAdsReadAdapter = new GoogleAdsReadAdapter();
