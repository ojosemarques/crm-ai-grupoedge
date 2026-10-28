import { describe, expect, it, vi } from "vitest";
import { MetaAdsReadAdapter } from "@/modules/integrations/application/meta-ads-read-adapter";
import { z } from "zod";

const config = { graphApiVersion: "v26.0" as const, selectedAccountIds: ["act_123456"], initialSince: "2026-09-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 };
const credentials = { accessToken: "test-only-token", appSecret: "test-only-secret" };
const ok = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { status: 200, ...(headers ? { headers } : {}) });

describe("CRM-40 adaptador Meta Ads somente leitura", () => {
  it("filters discovered accounts to the chosen BM and rejects an account moved to another BM", async () => {
    const adapter = new MetaAdsReadAdapter({ fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/me")) return ok({ id: "123456" });
      if (path.endsWith("/me/adaccounts")) return ok({ data: [{ id: "act_123456", name: "Selecionada", business: { id: "777777" } }, { id: "act_654321", name: "Outra", business: { id: "888888" } }] });
      return ok({ id: "act_123456", name: "Selecionada", business: { id: "888888" } });
    } });
    const scoped = { ...config, businessId: "777777" };
    expect((await adapter.testConnection(scoped, credentials)).accounts.map((item) => item.id)).toEqual(["act_123456"]);
    await expect(adapter.pull(scoped, credentials, { since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ failure: { code: "META_ACCOUNT_BUSINESS_MISMATCH" } });
  });
  it("accepts a system identity without a public profile name and still validates account access", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => new URL(String(input)).pathname.endsWith("/me")
      ? ok({ id: "61595619636279" })
      : ok({ data: [{ id: "act_857477559328413", name: "Conta8", currency: "BRL" }] }));
    const result = await new MetaAdsReadAdapter({ fetcher }).testConnection(config, credentials);
    expect(result.identity).toEqual({ id: "61595619636279" });
    expect(result.accounts[0]?.id).toBe("act_857477559328413");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports only known contract fields without returning rejected values", () => {
    const parsed = z.object({ name: z.number(), access_token: z.number() }).safeParse({ name: "private-name", access_token: "private-token" });
    if (parsed.success) throw new Error("Expected invalid fixture");
    const failure = new MetaAdsReadAdapter().classifyError(parsed.error);
    expect(failure.safeMessage).toContain("Campos: name.");
    expect(JSON.stringify(failure)).not.toMatch(/private-name|private-token|access_token/);
  });
  it("usa origem fixa, GET, bearer server-side e paginação por cursor", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input)); calls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname.endsWith("/me")) return ok({ id: "123456", name: "Usuário teste" });
      if (!url.searchParams.has("after")) return ok({ data: [{ id: "act_123456", account_id: "123456", name: "Conta A", currency: "BRL", timezone_name: "America/Sao_Paulo" }], paging: { cursors: { after: "cursor-safe" } } });
      return ok({ data: [{ id: "act_654321", account_id: "654321", name: "Conta B", currency: "BRL", timezone_name: "America/Sao_Paulo" }] });
    });
    const result = await new MetaAdsReadAdapter({ fetcher }).testConnection(config, credentials);
    expect(result.accounts).toHaveLength(2);
    expect(calls.every(({ url }) => url.origin === "https://graph.facebook.com" && url.pathname.startsWith("/v26.0/"))).toBe(true);
    expect(calls.every(({ init }) => init?.method === "GET")).toBe(true);
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer test-only-token" });
    expect(JSON.stringify(result)).not.toContain("test-only-token");
  });

  it("respeita Retry-After e não devolve segredo no erro", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const adapter = new MetaAdsReadAdapter({ random: () => 0, sleep: async (milliseconds) => { delays.push(milliseconds); }, fetcher: async (input) => {
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ error: { message: "token hidden", code: 4 } }), { status: 429, headers: { "retry-after": "3" } });
      return new URL(String(input)).pathname.endsWith("/me") ? ok({ id: "123456", name: "Usuário teste" }) : ok({ data: [] });
    } });
    await expect(adapter.testConnection({ ...config, selectedAccountIds: [] }, credentials)).resolves.toMatchObject({ identity: { id: "123456" } });
    expect(delays).toEqual([3_000]);
  });

  it("classifica autenticação, payload inválido e resposta grande", async () => {
    const auth = new MetaAdsReadAdapter({ fetcher: async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }) });
    await expect(auth.testConnection(config, credentials)).rejects.toMatchObject({ failure: { classification: "AUTHENTICATION" } });
    const malformed = new MetaAdsReadAdapter({ fetcher: async () => ok({ unexpected: true }) });
    await expect(malformed.testConnection(config, credentials)).rejects.toBeTruthy();
    const large = new MetaAdsReadAdapter({ fetcher: async () => ok({}, { "content-length": String(2 * 1024 * 1024 + 1) }) });
    await expect(large.testConnection(config, credentials)).rejects.toMatchObject({ failure: { code: "META_RESPONSE_TOO_LARGE" } });
  });

  it("normaliza hierarquia e insights sem executar escrita externa", async () => {
    const methods: string[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      methods.push(String(init?.method)); const path = new URL(String(input)).pathname;
      if (path.endsWith("/act_123456")) return ok({ id: "act_123456", account_id: "123456", name: "Conta A", account_status: 1, currency: "BRL", timezone_name: "America/Sao_Paulo" });
      if (path.endsWith("/campaigns")) return ok({ data: [{ id: "200001", name: "Campanha", status: "ACTIVE" }] });
      if (path.endsWith("/adsets")) return ok({ data: [{ id: "300001", campaign_id: "200001", name: "Conjunto", status: "PAUSED" }] });
      if (path.endsWith("/ads")) return ok({ data: [{ id: "400001", adset_id: "300001", name: "Anúncio", status: "ACTIVE", creative: { id: "500001", name: "Criativo" } }] });
      return ok({ data: [{ account_id: "123456", account_name: "Conta A", account_currency: "BRL", campaign_id: "200001", campaign_name: "Campanha", adset_id: "300001", adset_name: "Conjunto", ad_id: "400001", ad_name: "Anúncio", date_start: "2026-09-01", date_stop: "2026-09-01", spend: "10.25", impressions: "100", clicks: "8", actions: [{ action_type: "lead", value: "2" }] }] });
    };
    const result = await new MetaAdsReadAdapter({ fetcher }).pull(config, credentials, { since: "2026-09-01", until: "2026-09-02" });
    expect(result.hierarchy).toMatchObject({ accounts: [{ id: "act_123456" }], campaigns: [{ id: "200001" }], adSets: [{ id: "300001" }], ads: [{ id: "400001" }] });
    expect(result.insights[0]).toMatchObject({ spend: "10.25", actions: [{ action_type: "lead", value: "2" }] });
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
});
