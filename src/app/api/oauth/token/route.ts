import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { oauthErrorResponse, readForm, uniqueParam } from "@/app/api/oauth/route-helpers";
import { getPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const form = await readForm(request);
    const grantType = uniqueParam(form, "grant_type")!;
    const clientId = uniqueParam(form, "client_id")!;
    const resource = uniqueParam(form, "resource")!;
    const service = getPolitizaiMcpOAuthService();
    const token = grantType === "authorization_code"
      ? await service.exchangeAuthorizationCode({
          code: uniqueParam(form, "code")!,
          codeVerifier: uniqueParam(form, "code_verifier")!,
          redirectUri: uniqueParam(form, "redirect_uri")!,
          clientId,
          resource,
        })
      : grantType === "refresh_token"
        ? await service.refreshAccessToken({
            refreshToken: uniqueParam(form, "refresh_token")!,
            clientId,
            resource,
            ...(uniqueParam(form, "scope", false) ? { scope: uniqueParam(form, "scope", false)! } : {}),
          })
        : (() => { throw new OAuthError(OAuthErrorCode.UnsupportedGrantType, "Grant OAuth não suportado."); })();
    return NextResponse.json(token, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
