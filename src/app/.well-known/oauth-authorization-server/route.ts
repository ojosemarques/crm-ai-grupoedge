import { NextResponse } from "next/server";

import {
  POLITIZAI_MCP_CLIENT_ID,
  POLITIZAI_MCP_SCOPES,
  getPolitizaiMcpPublicConfig,
} from "@/modules/prospecting/domain/politizai-mcp-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const config = getPolitizaiMcpPublicConfig();
  return NextResponse.json({
    issuer: config.issuer.href.replace(/\/$/, ""),
    authorization_endpoint: config.authorizationEndpoint.href,
    token_endpoint: config.tokenEndpoint.href,
    revocation_endpoint: config.revocationEndpoint.href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: POLITIZAI_MCP_SCOPES,
    client_id_metadata_document_supported: true,
    client_registration_types_supported: ["client_id_metadata_document"],
    client_metadata_documents_supported: [POLITIZAI_MCP_CLIENT_ID],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
