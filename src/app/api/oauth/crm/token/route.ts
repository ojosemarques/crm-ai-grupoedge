import { NextResponse } from "next/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { uniqueParam } from "@/app/api/oauth/route-helpers";
import { getCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { oauthFailure, oauthHeaders, oauthOptions, rateLimitOAuth, readOAuthForm } from "../route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await rateLimitOAuth(request, "token");
    const form = await readOAuthForm(request);
    if (request.headers.has("authorization") || form.has("client_secret") || form.has("client_assertion")) throw new OAuthError(OAuthErrorCode.InvalidClient, "Este cliente público usa PKCE e autenticação none.");
    const clientId = uniqueParam(form, "client_id")!;
    const resource = uniqueParam(form, "resource")!;
    const grantType = uniqueParam(form, "grant_type")!;
    const service = getCrmMcpOAuthService();
    const result = grantType === "authorization_code"
      ? await service.exchangeAuthorizationCode({ code: uniqueParam(form, "code")!, codeVerifier: uniqueParam(form, "code_verifier")!, clientId, resource, redirectUri: uniqueParam(form, "redirect_uri")! })
      : grantType === "refresh_token"
        ? await service.refreshAccessToken({ refreshToken: uniqueParam(form, "refresh_token")!, clientId, resource, ...(form.has("scope") ? { scope: uniqueParam(form, "scope")! } : {}) })
        : (() => { throw new OAuthError(OAuthErrorCode.UnsupportedGrantType, "Grant OAuth não suportado."); })();
    return NextResponse.json(result, { headers: oauthHeaders });
  } catch (error) { return oauthFailure(error); }
}
export const OPTIONS = oauthOptions;
