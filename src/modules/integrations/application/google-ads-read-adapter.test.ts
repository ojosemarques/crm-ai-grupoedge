import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleAdsReadAdapter } from "@/modules/integrations/application/google-ads-read-adapter";

const config = {
  apiVersion: "v25" as const,
  authStrategy: "OAUTH_REFRESH_TOKEN" as const,
  loginCustomerId: "1111111111",
  selectedCustomerIds: ["2222222222"],
  initialSince: "2026-09-01",
  lookbackDays: 7,
  pageSize: 100,
  requestTimeoutMs: 2_000,
};
const oauth = { strategy: "OAUTH_REFRESH_TOKEN" as const, oauthClientId: "fixture-client-id", oauthClientSecret: "fixture-client-secret", oauthRefreshToken: "fixture-refresh-token", developerToken: null };
const ok = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { status: 200, ...(headers ? { headers } : {}) });
const customer = { customerClient: { id: "2222222222", clientCustomer: "customers/2222222222", descriptiveName: "Politizai Fixture", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false, level: "1", status: "ENABLED" } };
const metric = { customer: { id: "2222222222", descriptiveName: "Politizai Fixture", currencyCode: "BRL", timeZone: "America/Sao_Paulo" }, campaign: { id: "300001", resourceName: "customers/2222222222/campaigns/300001", name: "Campanha", status: "ENABLED", advertisingChannelType: "SEARCH" }, adGroup: { id: "400001", resourceName: "customers/2222222222/adGroups/400001", name: "Grupo", status: "ENABLED" }, adGroupAd: { resourceName: "customers/2222222222/adGroupAds/400001~500001", status: "ENABLED", ad: { id: "500001", resourceName: "customers/2222222222/ads/500001", name: "Anúncio", type: "RESPONSIVE_SEARCH_AD" } }, segments: { date: "2026-09-01" }, metrics: { costMicros: "10250000", impressions: "1000", clicks: "50", interactions: "55", conversions: "2.5", conversionsValue: "500.25", allConversions: "3", allConversionsValue: "600", ctr: "0.05", averageCpc: "205000", averageCpm: "10250000" } };
const asset = { adGroupAdAssetView: { resourceName: "customers/2222222222/adGroupAdAssetViews/a", fieldType: "HEADLINE", performanceLabel: "GOOD", enabled: true }, adGroupAd: { resourceName: metric.adGroupAd.resourceName, ad: metric.adGroupAd.ad }, asset: { id: "600001", resourceName: "customers/2222222222/assets/600001", name: "Título", type: "TEXT" } };

describe("CRM-41 adaptador Google Ads estritamente read-only", () => {
  it("faz token exchange, descoberta e hierarquia sem rota Mutate", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const adapter = new GoogleAdsReadAdapter({ fetcher: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.origin === "https://oauth2.googleapis.com") return ok({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 3600 });
      if (url.pathname.endsWith("customers:listAccessibleCustomers")) return ok({ resourceNames: ["customers/1111111111"] }, { "request-id": "request-accessible" });
      return ok({ results: [customer] }, { "request-id": "request-hierarchy" });
    } });
    const result = await adapter.discover(config, oauth);
    expect(result).toMatchObject({ accessibleCustomerIds: ["1111111111"], hierarchy: [customer] });
    expect(calls.map(({ url }) => url.origin)).toEqual(["https://oauth2.googleapis.com", "https://googleads.googleapis.com", "https://googleads.googleapis.com"]);
    expect(calls.some(({ url }) => /mutate/i.test(url.pathname))).toBe(false);
    const hierarchyCall = calls[2]!;
    expect(hierarchyCall.init?.headers).toMatchObject({ Authorization: "Bearer fixture-access-token", "login-customer-id": "1111111111" });
    expect(hierarchyCall.init?.headers).not.toHaveProperty("developer-token");
    expect(JSON.stringify(result)).not.toContain("fixture-refresh-token");
  });

  it("pagina Search, preserva métricas Google e múltiplos ativos", async () => {
    const queries: string[] = [];
    let metricPage = 0;
    const adapter = new GoogleAdsReadAdapter({ fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://oauth2.googleapis.com") return ok({ access_token: "fixture-access-token", token_type: "Bearer" });
      const body = JSON.parse(String(init?.body)) as { query: string; pageToken?: string };
      queries.push(body.query);
      if (body.query.includes("FROM ad_group_ad_asset_view")) return ok({ results: [asset] }, { "request-id": "asset-request" });
      metricPage += 1;
      return metricPage === 1 ? ok({ results: [metric], nextPageToken: "safe-next" }, { "request-id": "metric-1" }) : ok({ results: [{ ...metric, segments: { date: "2026-09-02" } }] }, { "request-id": "metric-2" });
    } });
    const result = await adapter.pull(config, oauth, { since: "2026-09-01", until: "2026-09-02" });
    expect(result.rows).toHaveLength(2);
    expect(result.assets).toEqual([asset]);
    expect(result.rows[0]?.metrics).toMatchObject({ conversions: "2.5", allConversions: "3", costMicros: "10250000" });
    expect(queries.some((query) => query.includes("segments.date BETWEEN '2026-09-01' AND '2026-09-02'"))).toBe(true);
  });

  it("respeita Retry-After e classifica falhas sem devolver segredo", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const adapter = new GoogleAdsReadAdapter({ random: () => 0, sleep: async (ms) => { delays.push(ms); }, fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.origin === "https://oauth2.googleapis.com") return ok({ access_token: "fixture-access-token", token_type: "Bearer" });
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "fixture-refresh-token" } }), { status: 429, headers: { "retry-after": "3" } });
      return url.pathname.endsWith("customers:listAccessibleCustomers") ? ok({ resourceNames: ["customers/1111111111"] }) : ok({ results: [customer] });
    } });
    await expect(adapter.discover(config, oauth)).resolves.toMatchObject({ accessibleCustomerIds: ["1111111111"] });
    expect(delays).toEqual([3_000]);
    const auth = new GoogleAdsReadAdapter({ fetcher: async (input) => new URL(String(input)).origin.includes("oauth2") ? ok({ access_token: "fixture-access-token", token_type: "Bearer" }) : new Response(JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), { status: 401 }) });
    await expect(auth.discover(config, oauth)).rejects.toMatchObject({ failure: { classification: "AUTHENTICATION", code: "GOOGLE_OAUTH_REJECTED" } });
  });

  it("gera assertion de service account apenas no POST OAuth", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const bodies: string[] = [];
    const adapter = new GoogleAdsReadAdapter({ now: () => new Date("2026-09-12T12:00:00Z"), fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://oauth2.googleapis.com") { bodies.push(String(init?.body)); return ok({ access_token: "fixture-access-token", token_type: "Bearer" }); }
      if (url.pathname.endsWith("customers:listAccessibleCustomers")) return ok({ resourceNames: [] });
      return ok({ results: [] });
    } });
    const result = await adapter.discover({ ...config, authStrategy: "SERVICE_ACCOUNT", loginCustomerId: null }, { strategy: "SERVICE_ACCOUNT", serviceAccountEmail: "fixture@example.invalid", serviceAccountPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    expect(result.accessibleCustomerIds).toEqual([]);
    expect(bodies[0]).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(bodies[0]).toContain("assertion=");
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });

  it("recusa templates fora da allowlist", () => {
    const adapter = new GoogleAdsReadAdapter();
    expect(() => adapter.queryTemplate("DELETE" as never)).toThrowError(/templates GAQL internos/i);
  });
});
