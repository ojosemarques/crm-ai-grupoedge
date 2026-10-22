import { createHash } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { authenticateCrmMcp, parseCrmMcpClients, crmMcpScopes, type CrmMcpIdentity } from "./crm-mcp-authentication";
import { assertCrmMcpPeriod, createCrmMcpServer, sanitizeCrmMcpResult, summarizeCrmMcpDashboard } from "./crm-mcp-server";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), revenueDrilldown: vi.fn(), authorize: vi.fn(), audit: vi.fn(),
  logs: vi.fn(), count: vi.fn(),
}));
vi.mock("@/modules/metrics/application/metrics-service", () => ({ getMetricsService: () => ({ getIntegratedOverview: mocks.overview }) }));
vi.mock("@/modules/metrics/application/revenue-metrics-service", () => ({ getRevenueMetricsService: () => ({ getDrilldown: mocks.revenueDrilldown }) }));
vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({ assertAuthorized: mocks.authorize }) }));
vi.mock("@/shared/core/database/client", () => ({ getDatabaseClient: () => ({ auditLog: { create: mocks.audit }, telemetryRecord: { findMany: mocks.logs, count: mocks.count } }) }));

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
    expect(response.result.serverInfo).toEqual({ name: "Grupo Edge CRM", version: "1.0.0" });
  });
  it("lists 20 read-only tools and valid JSON schemas", async () => {
    const response = await rpc("tools/list");
    expect(response.result.tools).toHaveLength(20);
    for (const tool of response.result.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
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
