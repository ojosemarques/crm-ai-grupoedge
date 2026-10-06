import { NextResponse } from "next/server";

import { POLITIZAI_MCP_SCOPES, getPolitizaiMcpPublicConfig } from "@/modules/prospecting/domain/politizai-mcp-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const config = getPolitizaiMcpPublicConfig();
  return NextResponse.json({
    resource: config.resource.href,
    authorization_servers: [config.issuer.href.replace(/\/$/, "")],
    scopes_supported: POLITIZAI_MCP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Politizai — Prospecção política",
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
