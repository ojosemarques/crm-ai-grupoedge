import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";

import { authenticateCrmMcp } from "@/modules/crm-mcp/application/crm-mcp-authentication";
import { createCrmMcpServer } from "@/modules/crm-mcp/application/crm-mcp-server";
import { crmMcpAuthChallenge } from "@/modules/crm-mcp/domain/crm-mcp-oauth-config";
import { crmMcpToolScopes } from "@/modules/crm-mcp/domain/crm-mcp-tool-scopes";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { getDatabaseClient } from "@/shared/core/database/client";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function serve(request: Request): Promise<Response> {
  try {
    const canonical = getApplicationConfig().environment.canonicalUrl;
    const hosts = [...new Set([canonical.hostname, process.env.VERCEL_URL, ...(process.env.APP_TRUSTED_HOSTS ?? "").split(",")].filter((host): host is string => Boolean(host)))];
    const rejected = hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, [canonical.hostname, "chatgpt.com", "chat.openai.com", "localhost", "127.0.0.1"]);
    if (rejected) return rejected;
    await enforceRateLimit("crm-mcp-entry", requestClientKey(request), { limit: 120, windowMs: 60_000 });
    const identity = await authenticateCrmMcp(request, getDatabaseClient());
    await enforceRateLimit("crm-mcp-client", `${identity.context.workspaceId}:${identity.clientId}`, { limit: 60, windowMs: 60_000 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    const body = (await readLimitedBuffer(request, 64 * 1024)).toString("utf8");
    let rpc: { method?: unknown; params?: { name?: unknown } } | null = null;
    try { rpc = JSON.parse(body); } catch { /* The MCP handler reports malformed JSON. */ }
    const name = rpc?.method === "tools/call" && typeof rpc.params?.name === "string" ? rpc.params.name : undefined;
    const required = name && Object.hasOwn(crmMcpToolScopes, name) ? crmMcpToolScopes[name] : undefined;
    if (required && !identity.scopes.includes(required as typeof identity.scopes[number])) {
      throw new ApplicationError("Escopo insuficiente para esta ferramenta.", { code: "CRM_MCP_INSUFFICIENT_SCOPE", statusCode: 403, expose: true, responseHeaders: { "WWW-Authenticate": crmMcpAuthChallenge("insufficient_scope", required) } });
    }
    const handler = createMcpHandler(() => createCrmMcpServer(identity), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 64 * 1024 });
    const response = await handler.fetch(new Request(request.url, { method: "POST", headers: request.headers, body }));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = handleRouteError(error);
    response.headers.set("Cache-Control", "private, no-store");
    if (response.status === 401) response.headers.set("WWW-Authenticate", crmMcpAuthChallenge(request.headers.has("authorization") ? "invalid_token" : undefined));
    return response;
  }
}

export const POST = serve;
// OAuth clients probe GET for the authentication challenge before connecting.
export const GET = serve;
export const DELETE = serve;
