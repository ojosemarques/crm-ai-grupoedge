import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/modules/crm-mcp/application/crm-mcp-authentication", () => ({ authenticateCrmMcp: mocks.authenticate }));
vi.mock("@/modules/crm-mcp/application/crm-mcp-server", () => ({ createCrmMcpServer: () => {
  const server = new McpServer({ name: "test", version: "1" });
  server.registerTool("ping", {}, async () => ({ content: [] }));
  return server;
} }));
vi.mock("@/shared/core/config/application-config", () => ({ getApplicationConfig: () => ({ environment: { canonicalUrl: new URL("https://crm.example") } }) }));
vi.mock("@/shared/core/database/client", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/shared/core/http/request-hardening", async (original) => ({ ...await original<typeof import("@/shared/core/http/request-hardening")>(), enforceRateLimit: mocks.rateLimit, requestClientKey: () => "test-ip" }));

function request(headers: Record<string, string> = {}, body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })) {
  return new Request("https://crm.example/api/mcp/crm", { method: "POST", headers: { host: "crm.example", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26", ...headers }, body });
}
function allow() { mocks.authenticate.mockResolvedValue({ clientId: "bot", scopes: ["crm:read"], context: { workspaceId: "workspace" } }); mocks.rateLimit.mockResolvedValue(undefined); }

describe("CRM MCP HTTP boundary", () => {
  it("rejects absent/invalid credentials with an auth challenge and no cache", async () => {
    mocks.authenticate.mockRejectedValueOnce(new ApplicationError("Credencial inválida", { code: "CRM_MCP_UNAUTHORIZED", statusCode: 401, expose: true }));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="https://crm.example/.well-known/oauth-protected-resource/api/mcp/crm"');
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects unknown Host and untrusted browser Origin before authentication", async () => {
    mocks.authenticate.mockClear();
    expect((await POST(request({ host: "attacker.example" }))).status).toBe(403);
    expect((await POST(request({ origin: "https://attacker.example" }))).status).toBe(403);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it("enforces the shared per-client rate limit", async () => {
    allow(); mocks.rateLimit.mockClear();
    mocks.rateLimit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApplicationError("Limite", { code: "RATE_LIMITED", statusCode: 429, expose: true, responseHeaders: { "Retry-After": "60" } }));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.rateLimit).toHaveBeenLastCalledWith("crm-mcp-client", "workspace:bot", { limit: 60, windowMs: 60_000 });
  });
  it("serves authenticated MCP over stateless HTTP without caching", async () => {
    allow();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain('"name":"ping"');
  });
  it("rejects an oversized body", async () => {
    allow();
    const response = await POST(request({}, "x".repeat(65 * 1024)));
    expect(response.status).toBe(413);
  });
  it("rejects malformed JSON", async () => {
    allow();
    expect((await POST(request({}, "{"))).status).toBe(400);
  });
  it("challenges unauthenticated GET probes for OAuth discovery", async () => {
    mocks.authenticate.mockRejectedValueOnce(new ApplicationError("Credencial inválida", { code: "CRM_MCP_UNAUTHORIZED", statusCode: 401, expose: true }));
    const response = await GET(new Request("https://crm.example/api/mcp/crm", { headers: { host: "crm.example" } }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
  it("does not expose an authenticated GET event stream or DELETE session endpoint", async () => {
    allow();
    expect((await GET(new Request("https://crm.example/api/mcp/crm", { headers: { host: "crm.example" } }))).status).toBe(405);
    expect((await DELETE(new Request("https://crm.example/api/mcp/crm", { method: "DELETE", headers: { host: "crm.example" } }))).headers.get("allow")).toBe("POST");
  });
  it("rejects a tool call with insufficient scopes using HTTP 403 and a scope challenge", async () => {
    allow();
    const response = await POST(request({}, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "consultar_auditoria", arguments: {} } })));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("www-authenticate")).toContain('scope="audit:read"');
  });
});
