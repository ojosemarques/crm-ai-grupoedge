import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";

import { authenticateCrmMcp } from "@/modules/crm-mcp/application/crm-mcp-authentication";
import { createCrmMcpServer } from "@/modules/crm-mcp/application/crm-mcp-server";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { getDatabaseClient } from "@/shared/core/database/client";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const canonical = getApplicationConfig().environment.canonicalUrl;
    const hosts = [...new Set([canonical.hostname, process.env.VERCEL_URL, ...(process.env.APP_TRUSTED_HOSTS ?? "").split(",")].filter((host): host is string => Boolean(host)))];
    const rejected = hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, [canonical.hostname, "chatgpt.com", "chat.openai.com", "localhost", "127.0.0.1"]);
    if (rejected) return rejected;
    await enforceRateLimit("crm-mcp-entry", requestClientKey(request), { limit: 120, windowMs: 60_000 });
    const identity = await authenticateCrmMcp(request, getDatabaseClient());
    await enforceRateLimit("crm-mcp-client", `${identity.context.workspaceId}:${identity.clientId}`, { limit: 60, windowMs: 60_000 });
    const handler = createMcpHandler(() => createCrmMcpServer(identity), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 64 * 1024 });
    const response = await handler.fetch(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = handleRouteError(error);
    response.headers.set("Cache-Control", "private, no-store");
    if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="crm-mcp"');
    return response;
  }
}

// Stateless Streamable HTTP has no standalone server event stream.
export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
export const DELETE = GET;
