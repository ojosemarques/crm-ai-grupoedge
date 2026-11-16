import { createHash } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { authenticateCrmMcp, parseCrmMcpClients, crmMcpScopes, type CrmMcpIdentity } from "./crm-mcp-authentication";
import { assertCrmMcpPeriod, createCrmMcpServer, sanitizeCrmMcpResult, summarizeCrmMcpDashboard } from "./crm-mcp-server";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), revenueDrilldown: vi.fn(), authorize: vi.fn(), audit: vi.fn(),
  logs: vi.fn(), count: vi.fn(), media: vi.fn(), advertising: vi.fn(), pipeline: vi.fn(), meta: vi.fn(),
  dashboard: vi.fn(), dashboardDrilldown: vi.fn(), integratedDrilldown: vi.fn(), frontEvidence: vi.fn(),
  board: vi.fn(), tasks: vi.fn(), history: vi.fn(),
  realtime: vi.fn(), finance: vi.fn(), supporting: vi.fn(), financeGoals: vi.fn(),
  google: vi.fn(), nativeForms: vi.fn(), forms: vi.fn(), formDetails: vi.fn(), formCatalog: vi.fn(),
  responses: vi.fn(), responseDetail: vi.fn(), formStats: vi.fn(), strategies: vi.fn(), attribution: vi.fn(), workspace: vi.fn(),
}));
vi.mock("@/modules/acquisition-api/application/meta-native-service", () => ({ getMetaNativeService: () => ({ list: mocks.nativeForms }) }));
vi.mock("@/modules/integrations/application/google-ads-service", () => ({ getGoogleAdsService: () => ({ screen: mocks.google }) }));
vi.mock("@/modules/marketing/application/strategy-funnel-service", () => ({ getStrategyFunnelService: () => ({ screen: mocks.strategies }) }));
vi.mock("@/modules/marketing/application/marketing-attribution-service", () => ({ getMarketingAttributionService: () => ({ getScreen: mocks.attribution }) }));
vi.mock("@/modules/marketing-forms/application/marketing-form-service", () => ({ getMarketingFormService: () => ({
  list: mocks.forms, detail: mocks.formDetails, catalog: mocks.formCatalog,
}) }));
vi.mock("@/modules/marketing-forms/application/marketing-form-reporting-service", () => ({ getMarketingFormReportingService: () => ({
  list: mocks.responses, detailById: mocks.responseDetail, statistics: mocks.formStats,
}) }));
vi.mock("@/modules/realtime-dashboard/application/realtime-dashboard-service", () => ({ getRealtimeDashboardService: () => ({ advertisingSnapshot: mocks.realtime }) }));
vi.mock("@/modules/finance/application/finance-service", () => ({ getFinanceService: () => ({
  screen: mocks.finance, listSupportingRecords: mocks.supporting, goals: mocks.financeGoals,
}) }));
vi.mock("@/modules/metrics/application/metrics-service", () => ({ getMetricsService: () => ({
  getIntegratedOverview: mocks.overview, getIntegratedDrilldown: mocks.integratedDrilldown, getCommercialFrontEvidence: mocks.frontEvidence,
}) }));
vi.mock("@/modules/metrics/application/dashboard-metrics-service", () => ({ getDashboardMetricsService: () => ({
  getScreen: mocks.dashboard, getDrilldown: mocks.dashboardDrilldown,
}) }));
vi.mock("@/modules/metrics/application/revenue-metrics-service", () => ({ getRevenueMetricsService: () => ({ getDrilldown: mocks.revenueDrilldown }) }));
vi.mock("@/modules/marketing/application/media-performance-service", () => ({ getMediaPerformanceService: () => ({ getScreen: mocks.media }) }));
vi.mock("@/modules/advertising/application/advertising-workspace-service", () => ({ getAdvertisingWorkspaceService: () => ({ getScreen: mocks.advertising, getActivities: mocks.tasks }) }));
vi.mock("@/modules/activities/application/commercial-history-service", () => ({ getCommercialHistoryService: () => ({ getHistory: mocks.history }) }));
vi.mock("@/modules/pipelines/application/pre-sales-pipeline-service", async (original) => ({
  ...await original<typeof import("@/modules/pipelines/application/pre-sales-pipeline-service")>(),
  getPreSalesPipelineService: () => ({ getScreen: mocks.board }),
}));
vi.mock("@/modules/integrations/application/meta-ads-service", () => ({ getMetaAdsService: () => ({ screen: mocks.meta }) }));
vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({ assertAuthorized: mocks.authorize }) }));
vi.mock("@/shared/core/database/client", () => ({ getDatabaseClient: () => ({ auditLog: { create: mocks.audit }, telemetryRecord: { findMany: mocks.logs, count: mocks.count }, pipeline: { findFirst: mocks.pipeline }, workspace: { findUniqueOrThrow: mocks.workspace } }) }));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const roleId = "55555555-5555-4555-8555-555555555555";
const token = "test_credential_".padEnd(43, "x");
const client = { clientId: "test-bot", workspaceId, memberId, tokenHash: createHash("sha256").update(token).digest("hex"), scopes: [...crmMcpScopes], expiresAt: "2099-01-01T00:00:00.000Z" };
const identity: CrmMcpIdentity = { clientId: client.clientId, scopes: [...crmMcpScopes], context: { workspaceId, workspaceSlug: "test", memberId, userId, actorId, roleId, roleKey: "admin", roleName: "Administrador", displayName: "Test", sessionId: "mcp:test-bot" } };
const query = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z" };

function databaseFixture() {
  const member = vi.fn().mockResolvedValue({ id: memberId, userId, roleId, role: { key: "admin", name: "Administrador" }, workspace: { slug: "test" }, user: { displayName: "Test" } });
  const actor = vi.fn().mockResolvedValue({ id: actorId });
  return { member, actor, database: { workspaceMember: { findFirst: member }, actor: { findFirst: actor } } as unknown as Pick<PrismaClient, "workspaceMember" | "actor"> };
}
function request(authorization = `Bearer ${token}`) { return new Request("https://crm.example/api/mcp/crm", { headers: { authorization } }); }
async function rpc(method: string, params: unknown = {}, scopes = identity.scopes) {
  const handler = createMcpHandler(() => createCrmMcpServer({ ...identity, scopes }), { legacy: "stateless", responseMode: "json" });
  try {
    const response = await handler.fetch(new Request("https://crm.example/api/mcp/crm", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
    expect(response.status).toBe(200);
    const body = await response.text();
    return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream")
      ? body.split("\n").find((line) => line.startsWith("data: "))!.slice(6)
      : body);
  } finally { await handler.close(); }
}

describe("CRM MCP authentication boundary", () => {
  it("authenticates the configured member and pins the workspace server-side", async () => {
    const fixture = databaseFixture();
    const result = await authenticateCrmMcp(request(), fixture.database, JSON.stringify([client]));
    expect(result.context.workspaceId).toBe(workspaceId);
    expect(result.context.actorId).toBe(actorId);
    expect(fixture.member).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: memberId, workspaceId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null } }) }));
  });
  it.each(["", "Basic abc", "Bearer short", `Bearer ${"x".repeat(43)}`])("rejects missing, malformed and wrong credentials (%s)", async (header) => {
    const fixture = databaseFixture();
    await expect(authenticateCrmMcp(request(header), fixture.database, JSON.stringify([client]))).rejects.toMatchObject({ statusCode: 401 });
    expect(fixture.member).not.toHaveBeenCalled();
  });
  it("rejects expired credentials before accessing member records", async () => {
    const fixture = databaseFixture();
    await expect(authenticateCrmMcp(request(), fixture.database, JSON.stringify([{ ...client, expiresAt: "2020-01-01T00:00:00.000Z" }]))).rejects.toMatchObject({ statusCode: 401 });
    expect(fixture.member).not.toHaveBeenCalled();
  });
  it("rejects revoked credentials", async () => {
    const fixture = databaseFixture();
    await expect(authenticateCrmMcp(request(), fixture.database, JSON.stringify([{ ...client, tokenHash: "a".repeat(64) }]))).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each(["member", "actor"] as const)("rejects inactive/missing %s without a cached context", async (record) => {
    const fixture = databaseFixture();
    fixture[record].mockResolvedValue(null);
    await expect(authenticateCrmMcp(request(), fixture.database, JSON.stringify([client]))).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each([undefined, "invalid", "[]", JSON.stringify([{ ...client, workspaceId: "wrong" }]), JSON.stringify([client, client])])("fails closed for invalid configuration", (value) => {
    expect(() => parseCrmMcpClients(value)).toThrow("MCP do CRM não configurado.");
  });
});

describe("CRM MCP protocol and read tools", () => {
  it("completes the MCP initialize handshake", async () => {
    const response = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(response.result.serverInfo).toEqual({ name: "Grupo Edge CRM", version: "1.3.0" });
  });
  it("lists 43 read-only tools and valid JSON schemas", async () => {
    const response = await rpc("tools/list");
    expect(response.result.tools).toHaveLength(43);
    for (const tool of response.result.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
  it("reads acquisition from the canonical media service with a bounded local period", async () => {
    mocks.media.mockResolvedValue({ totals: { spendCents: 1250, clicks: 10 }, metrics: [{ key: "cpc", value: 125 }] });
    const input = { periodStart: "2026-10-28", periodEnd: "2026-10-28" };
    const response = await rpc("tools/call", { name: "consultar_aquisicao", arguments: input });
    expect(response.result.structuredContent.data.totals.spendCents).toBe(1250);
    expect(mocks.media).toHaveBeenCalledWith(identity.context, input);
    mocks.media.mockClear();
    const denied = await rpc("tools/call", { name: "consultar_aquisicao", arguments: { periodStart: "2020-01-01", periodEnd: "2026-10-28" } });
    expect(denied.result.isError).toBe(true);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it("pins advertising to the workspace pipeline and keeps lead stock out of metric responses", async () => {
    mocks.pipeline.mockResolvedValue({ id: roleId });
    mocks.advertising.mockResolvedValue({ pipeline: { id: roleId }, stock: { page: 2, items: [{ id: userId }] }, metrics: { totals: { leadsReceived: 7 } }, timeZone: "America/Sao_Paulo" });
    const response = await rpc("tools/call", { name: "consultar_leads_anuncios", arguments: { page: 2 } });
    expect(response.result.structuredContent.data.stock.page).toBe(2);
    expect(mocks.pipeline).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId, name: "Anúncios", deletedAt: null }) }));
    expect(mocks.advertising).toHaveBeenCalledWith(identity.context, { page: 2, pipelineId: roleId });
    const metrics = await rpc("tools/call", { name: "consultar_metricas_anuncios", arguments: { metricsPreset: "TODAY" } });
    expect(metrics.result.structuredContent.data.metrics.totals.leadsReceived).toBe(7);
    expect(metrics.result.structuredContent.data).not.toHaveProperty("stock");
    const denied = await rpc("tools/call", { name: "consultar_leads_anuncios", arguments: {} }, ["metrics:read"]);
    expect(denied.result?.isError || denied.error).toBeTruthy();
  });
  it("applies canonical marketing RBAC and does not expose internal errors", async () => {
    mocks.media.mockRejectedValue(new Error("private-access-token"));
    const response = await rpc("tools/call", { name: "consultar_aquisicao", arguments: { periodStart: "2026-10-28", periodEnd: "2026-10-28" } });
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain("private-access-token");
  });
  it("uses the workspace calendar for the strategy funnel and attribution", async () => {
    mocks.workspace.mockResolvedValue({ timeZone: "America/Sao_Paulo" });
    mocks.strategies.mockResolvedValue({ strategies: [] });
    mocks.attribution.mockResolvedValue({
      definitions: { landingPages: [], forms: [{ id: roleId, name: "Form", draftDefinition: { raw: "internal" } }] },
      runs: [{ id: roleId, status: "COMPLETED", errorMessage: "internal" }],
      issues: [{ id: memberId, status: "OPEN", evidence: "internal" }],
      permissions: { canExportEvidence: false }, journey: { stages: [] },
    });
    const period = { periodStart: "2026-11-01", periodEnd: "2026-11-01" };
    const expected = { periodStart: new Date("2026-11-01T03:00:00Z"), periodEnd: new Date("2026-11-02T03:00:00Z") };
    const funnel = await rpc("tools/call", { name: "consultar_funis_marketing", arguments: period }, ["metrics:read"]);
    expect(funnel.result.structuredContent.data).toEqual({ strategies: [] });
    expect(mocks.strategies).toHaveBeenCalledWith(identity.context, expected);
    const attribution = await rpc("tools/call", { name: "consultar_atribuicao_marketing", arguments: { ...period, sourceId: roleId } }, ["metrics:read"]);
    expect(mocks.attribution).toHaveBeenCalledWith(identity.context, { ...expected, sourceId: roleId });
    expect(attribution.result.structuredContent.data.definitions.forms).toEqual([{ id: roleId, name: "Form" }]);
    expect(JSON.stringify(attribution)).not.toContain("internal");
  });
  it("honors form permissions and does not return public agenda receipt IDs", async () => {
    mocks.responses.mockClear().mockResolvedValue({ page: 1, total: 1, items: [{ id: memberId, publicId: "private-booking-link-id", status: "INCOMPLETO" }] });
    mocks.responseDetail.mockResolvedValue({ receipt: { publicId: "private-booking-link-id", status: "INCOMPLETO" }, answers: [] });
    mocks.authorize.mockRejectedValueOnce(new Error("denied"));
    const args = { name: "listar_respostas_marketing", arguments: { formId: roleId, status: "INCOMPLETO", pageSize: 1 } };
    expect((await rpc("tools/call", args)).result.isError).toBe(true);
    expect(mocks.responses).not.toHaveBeenCalled();
    const response = await rpc("tools/call", args);
    expect(response.result.structuredContent.data.items).toEqual([{ id: memberId, status: "INCOMPLETO" }]);
    expect(mocks.authorize).toHaveBeenCalledWith(identity.context, "marketing.definitions.manage", { workspaceId, resourceType: "MarketingForm", resourceId: roleId });
    const detail = await rpc("tools/call", { name: "detalhar_resposta_marketing", arguments: { formId: roleId, responseId: memberId } });
    expect(mocks.responseDetail).toHaveBeenCalledWith(identity.context, roleId, memberId);
    expect(detail.result.structuredContent.data.receipt).toEqual({ id: memberId, status: "INCOMPLETO" });
  });
  it("supports CRM forms, native forms and Google Ads under their respective scopes", async () => {
    mocks.forms.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ id: index })));
    const forms = await rpc("tools/call", { name: "listar_formularios_marketing", arguments: { page: 2, pageSize: 10 } }, ["crm:read"]);
    expect(forms.result.structuredContent.data).toMatchObject({ page: 2, hasMore: true });
    expect(forms.result.structuredContent.data.items).toHaveLength(10);
    expect(mocks.forms).toHaveBeenCalledWith(identity.context, { skip: 10, take: 11 });
    mocks.nativeForms.mockResolvedValue([{ id: roleId, forms: [] }]);
    expect((await rpc("tools/call", { name: "consultar_formularios_nativos" }, ["crm:read"])).result.structuredContent.data).toEqual([{ id: roleId, forms: [] }]);
    mocks.google.mockClear().mockResolvedValue({ readiness: "NOT_CONFIGURED" });
    const denied = await rpc("tools/call", { name: "consultar_google_ads" }, ["crm:read"]);
    expect(denied.result?.isError || denied.error).toBeTruthy();
    expect(mocks.google).not.toHaveBeenCalled();
    const google = await rpc("tools/call", { name: "consultar_google_ads" }, ["integrations:read"]);
    expect(google.result.structuredContent.data).toEqual({ readiness: "NOT_CONFIGURED" });
  });
  it("uses the authorized advertising snapshot with a custom period and rejects another front", async () => {
    mocks.realtime.mockClear().mockResolvedValue({ today: {}, week: { ranking: [] } });
    const args = { periodPreset: "CUSTOM", periodFrom: "2026-11-01", periodTo: "2026-11-09" };
    const foreignFront = await rpc("tools/call", { name: "consultar_tempo_anuncios", arguments: { ...args, front: "PROSPECTING" } }, ["metrics:read"]);
    expect(foreignFront.result?.isError || foreignFront.error).toBeTruthy();
    mocks.authorize.mockRejectedValueOnce(new Error("denied"));
    const denied = await rpc("tools/call", { name: "consultar_tempo_anuncios", arguments: args }, ["metrics:read"]);
    expect(denied.result.isError).toBe(true);
    expect(mocks.realtime).not.toHaveBeenCalled();
    const response = await rpc("tools/call", { name: "consultar_tempo_anuncios", arguments: args }, ["metrics:read"]);
    expect(response.result.structuredContent.data).toMatchObject({ front: "ADVERTISING", week: { ranking: [] } });
    expect(mocks.authorize).toHaveBeenCalledWith(identity.context, "realtime.read", { workspaceId, resourceId: workspaceId, resourceType: "RealtimeDashboard" });
    expect(mocks.realtime).toHaveBeenCalledWith(identity.context, args);
  });
  it("keeps finance report data behind the CRM scope and hides restricted commission totals", async () => {
    mocks.finance.mockClear().mockResolvedValue({
      period: query, summary: { cashBalanceCents: "1000", commissionPaidCents: "42" }, permissions: { commissionsManage: false }, dashboard: { commission: null },
    });
    const denied = await rpc("tools/call", { name: "consultar_financeiro", arguments: {} }, ["metrics:read"]);
    expect(denied.result?.isError || denied.error).toBeTruthy();
    expect(mocks.finance).not.toHaveBeenCalled();
    const allowed = await rpc("tools/call", { name: "consultar_financeiro", arguments: query }, ["crm:read"]);
    expect(allowed.result.structuredContent.data.summary).toEqual({ cashBalanceCents: "1000" });
    expect(mocks.finance).toHaveBeenCalledWith(identity.context, query, { dashboard: true });
  });
  it("does not fall back to consolidated cash flow for an unknown account", async () => {
    mocks.finance.mockResolvedValue({ cashFlowReport: { accountId: null } });
    const response = await rpc("tools/call", {
      name: "consultar_financeiro", arguments: { report: "fluxo-caixa", accountId: roleId },
    }, ["crm:read"]);
    expect(response.result.isError).toBe(true);
  });
  it("paginates reconciliation and checks finance commission permissions before reading individual amounts", async () => {
    mocks.supporting.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ id: index })));
    const response = await rpc("tools/call", {
      name: "listar_financeiro", arguments: { section: "conciliacao", recordId: roleId, page: 2, pageSize: 10, ...query },
    }, ["crm:read"]);
    const data = response.result.structuredContent.data;
    expect(data).toMatchObject({ section: "conciliacao", hasMore: true, page: 2 });
    expect(data.items).toHaveLength(10);
    expect(mocks.supporting).toHaveBeenCalledWith(identity.context, { section: "conciliacao", recordId: roleId, page: 2, pageSize: 10, ...query });
    mocks.finance.mockClear();
    mocks.authorize.mockRejectedValueOnce(new Error("denied"));
    const denied = await rpc("tools/call", { name: "listar_financeiro", arguments: { section: "comissoes" } }, ["crm:read"]);
    expect(denied.result.isError).toBe(true);
    expect(mocks.finance).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(identity.context, "finance.commissions", { workspaceId, resourceType: "Finance" });
  });
  it("delegates financial goals for the requested month to the authorized finance service", async () => {
    mocks.financeGoals.mockResolvedValue({ people: [] });
    const response = await rpc("tools/call", { name: "consultar_metas_financeiras", arguments: { month: "2026-11" } }, ["crm:read"]);
    expect(response.result.structuredContent.data).toEqual({ people: [] });
    expect(mocks.financeGoals).toHaveBeenCalledWith(identity.context, "2026-11");
  });
  it("returns advertising pipeline health without returning lead cards", async () => {
    mocks.pipeline.mockResolvedValue({ id: roleId });
    mocks.board.mockResolvedValue({ pipelineId: roleId, stages: [{ id: memberId, count: 2, health: { averageHoursInStage: 10 }, leads: [{ id: userId }] }] });
    const response = await rpc("tools/call", { name: "consultar_pipeline_anuncios", arguments: { stageCode: "NEW", stateCode: "sp" } }, ["crm:read"]);
    expect(response.result.structuredContent.data.stages).toEqual([{ id: memberId, count: 2, health: { averageHoursInStage: 10 } }]);
    expect(mocks.board).toHaveBeenCalledWith(identity.context, expect.objectContaining({ pipelineId: roleId, stageCode: "NEW", stateCode: "SP" }));
  });
  it("paginates advertising tasks and history using the delegated lead scope", async () => {
    mocks.pipeline.mockResolvedValue({ id: roleId });
    mocks.tasks.mockResolvedValue({ page: 2, items: [] });
    mocks.history.mockResolvedValue({ page: 3, items: [] });
    const response = await rpc("tools/call", { name: "consultar_atividades_anuncios", arguments: { taskPage: 2, historyPage: 3, ...query } }, ["crm:read"]);
    expect(response.result.structuredContent.data).toMatchObject({ tasks: { page: 2 }, history: { page: 3 } });
    expect(mocks.tasks).toHaveBeenCalledWith(identity.context, roleId, 2);
    expect(mocks.history).toHaveBeenCalledWith(identity.context, { pipelineName: "Anúncios", pipelineId: roleId, page: 3, ...query });
  });
  it.each([
    ["detalhar_indicador_anuncios", { metricId: "call.attempted" }, mocks.integratedDrilldown],
    ["detalhar_funil_anuncios", { measure: "time-first-action" }, mocks.frontEvidence],
  ] as const)("pins %s to Anúncios and rejects another pipeline", async (name, args, delegatedRead) => {
    mocks.pipeline.mockResolvedValue({ id: roleId });
    delegatedRead.mockClear().mockResolvedValue({ records: [] });
    const injected = await rpc("tools/call", { name, arguments: { ...args, query: { ...query, filters: { pipelineIds: [memberId] } } } });
    expect(injected.result?.isError || injected.error).toBeTruthy();
    expect(delegatedRead).not.toHaveBeenCalled();
    const response = await rpc("tools/call", { name, arguments: { ...args, query } });
    expect(response.result.structuredContent.data.records).toEqual([]);
    expect(delegatedRead).toHaveBeenCalledWith(identity.context, expect.objectContaining({ query: { ...query, filters: { pipelineIds: [roleId] } } }));
  });
  it("reads only the advertising dashboard and omits workspace reconciliation totals", async () => {
    mocks.pipeline.mockResolvedValue({ id: roleId });
    mocks.dashboard.mockResolvedValue({
      commercialSummary: { total: { timing: [{ id: "time-booking" }] }, unclassifiedCount: 99 },
      integrated: { values: [], quality: { totalFacts: 2, reconciliationExpectedCount: 99 } },
    });
    mocks.dashboardDrilldown.mockResolvedValue({ records: [] });
    const dashboard = await rpc("tools/call", { name: "consultar_indicadores_anuncios", arguments: {} });
    expect(dashboard.result.structuredContent.data).toMatchObject({ commercialSummary: { total: { timing: [{ id: "time-booking" }] } }, integrated: { quality: { totalFacts: 2 } } });
    expect(JSON.stringify(dashboard)).not.toMatch(/unclassifiedCount|reconciliationExpectedCount/);
    expect(mocks.dashboard).toHaveBeenCalledWith(identity.context, expect.objectContaining({ mode: "ADVERTISING", pipeline: [roleId] }));
    const detail = await rpc("tools/call", { name: "detalhar_dashboard_anuncios", arguments: { view: "sample" } });
    expect(detail.result.structuredContent.data.records).toEqual([]);
    expect(mocks.dashboardDrilldown).toHaveBeenCalledWith(identity.context, expect.objectContaining({ view: "sample", mode: "ADVERTISING", pipeline: [roleId] }));
    mocks.pipeline.mockResolvedValueOnce(null);
    mocks.dashboard.mockClear();
    const missing = await rpc("tools/call", { name: "consultar_indicadores_anuncios", arguments: {} });
    expect(missing.result.isError).toBe(true);
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("limits discovery and execution to credential scopes", async () => {
    const response = await rpc("tools/list", {}, ["metrics:read"]);
    expect(response.result.tools.every((tool: { name: string }) => !tool.name.includes("auditoria") && !tool.name.includes("leads"))).toBe(true);
    const denied = await rpc("tools/call", { name: "consultar_auditoria", arguments: {} }, ["metrics:read"]);
    expect(denied.result?.isError || denied.error).toBeTruthy();
  });
  it("uses the canonical metrics service with the delegated context and audits the access", async () => {
    mocks.overview.mockResolvedValue({ amountCents: 9007199254740993n, available: true });
    const response = await rpc("tools/call", { name: "consultar_indicadores_integrados", arguments: query });
    expect(response.result.isError).not.toBe(true);
    expect(response.result.structuredContent.data.amountCents).toBe("9007199254740993");
    expect(mocks.overview).toHaveBeenCalledWith(identity.context, query);
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId, actorId, origin: "AI", metadata: { clientId: "test-bot", tool: "consultar_indicadores_integrados", result: "SUCCESS" } }) });
  });
  it("rejects client-supplied tenant and excessive periods without querying", async () => {
    mocks.overview.mockClear();
    const wrongTenant = await rpc("tools/call", { name: "consultar_indicadores_integrados", arguments: { ...query, workspaceId: userId } });
    expect(wrongTenant.result?.isError || wrongTenant.error).toBeTruthy();
    const excessive = await rpc("tools/call", { name: "consultar_indicadores_integrados", arguments: { ...query, from: "2020-01-01T00:00:00.000Z" } });
    expect(excessive.result.isError).toBe(true);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("maps the revenue metric ID to the canonical service contract", async () => {
    mocks.revenueDrilldown.mockResolvedValue({ records: [] });
    await rpc("tools/call", { name: "detalhar_receita", arguments: { metricId: "revenue.mrr" } });
    expect(mocks.revenueDrilldown).toHaveBeenCalledWith(identity.context, expect.objectContaining({ metric: "revenue.mrr", preset: "MONTH" }));
  });
  it("does not expose service errors or secrets", async () => {
    mocks.overview.mockRejectedValue(new Error("postgresql://user:private@localhost/test"));
    const response = await rpc("tools/call", { name: "consultar_indicadores_integrados", arguments: query });
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain("postgresql");
  });
  it("enforces operational RBAC before reading telemetry", async () => {
    mocks.logs.mockClear();
    mocks.authorize.mockRejectedValueOnce(new Error("denied"));
    const response = await rpc("tools/call", { name: "consultar_logs_operacionais", arguments: query });
    expect(response.result.isError).toBe(true);
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("scopes and paginates logs without exposing metadata or raw payloads", async () => {
    mocks.authorize.mockResolvedValue(undefined); mocks.logs.mockResolvedValue([]); mocks.count.mockResolvedValue(0);
    const response = await rpc("tools/call", { name: "consultar_logs_operacionais", arguments: { ...query, page: 2, pageSize: 10 } });
    expect(response.result.isError).not.toBe(true);
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId }), take: 10, skip: 10, select: expect.not.objectContaining({ metadata: true }) }));
  });
  it("rejects oversized output without silently truncating evidence", async () => {
    mocks.overview.mockResolvedValue({ value: "x".repeat(1048576) });
    const response = await rpc("tools/call", { name: "consultar_indicadores_integrados", arguments: query });
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("1 MiB");
  });
  it("preserves full metrics and redacts credentials recursively", () => {
    const result = sanitizeCrmMcpResult({ metrics: Array.from({ length: 120 }, (_, i) => ({ value: i })), secret: "private", nested: { access_token: "private" }, date: new Date("2026-01-01T00:00:00Z"), amount: 99999999999999999n }) as Record<string, unknown>;
    expect(result.metrics).toHaveLength(120);
    expect(result.secret).toBe("[REMOVIDO]");
    expect(result.nested).toEqual({ access_token: "[REMOVIDO]" });
    expect(result.date).toBe("2026-01-01T00:00:00.000Z");
    expect(result.amount).toBe("99999999999999999");
  });
  it("separates dashboard aggregates from unbounded drilldown evidence", () => {
    const result = summarizeCrmMcpDashboard({ kpis: [{ value: 90 }], overview: { leadsReceived: { count: 90 }, evidence: { leads: new Array(100000).fill("lead") } }, records: ["raw"], drilldowns: [{ id: "leads", title: "Leads", recordKeys: ["lead:1"] }] });
    expect(result).toEqual({ kpis: [{ value: 90 }], overview: { leadsReceived: { count: 90 } }, drilldowns: [{ id: "leads", title: "Leads" }] });
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  });
  it("rejects partial or reversed periods", () => {
    expect(() => assertCrmMcpPeriod({ preset: "CUSTOM" })).toThrow();
    expect(() => assertCrmMcpPeriod({ from: query.to, to: query.from })).toThrow();
    expect(() => assertCrmMcpPeriod({ from: query.from })).toThrow();
  });
});
