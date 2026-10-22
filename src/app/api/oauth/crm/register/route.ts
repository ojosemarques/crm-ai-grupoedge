import { NextResponse } from "next/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { getCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { readLimitedJson } from "@/shared/core/http/request-hardening";
import { oauthFailure, oauthHeaders, oauthOptions, rateLimitOAuth } from "../route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await rateLimitOAuth(request, "register");
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new OAuthError(OAuthErrorCode.InvalidRequest, "Use application/json.");
    return NextResponse.json(await getCrmMcpOAuthService().register(await readLimitedJson(request, 8 * 1024)), { status: 201, headers: oauthHeaders });
  } catch (error) { return oauthFailure(error); }
}
export const OPTIONS = oauthOptions;
