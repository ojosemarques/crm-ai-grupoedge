import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AuthenticationRequiredError, SessionExpiredError } from "@/modules/auth/domain/auth-errors";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { getCrmMcpOAuthConfig } from "@/modules/crm-mcp/domain/crm-mcp-oauth-config";
import { uniqueParam } from "@/app/api/oauth/route-helpers";
import { htmlEscape, oauthFailure, parseAuthorization, rateLimitOAuth, readOAuthForm } from "../route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function authorizeContext(request: NextRequest) {
  const context = await requireApiAuthentication(request);
  await getAuthorizationService().assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "McpIntegration", resourceId: context.workspaceId });
  return context;
}
// Keep Origin on the same-origin consent POST so the CSRF guard can validate it.
const browserHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(request: NextRequest) {
  try {
    await rateLimitOAuth(request, "authorize");
    const authorization = await parseAuthorization(request.nextUrl.searchParams);
    const context = await authorizeContext(request);
    const consent = await getCrmMcpOAuthService().createConsent(context, authorization);
    const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Autorizar acesso ao CRM</title></head><body><main><h1>Conectar ${htmlEscape(authorization.clientName)} ao CRM</h1><p>Cliente registrado dinamicamente. O nome informado pelo cliente não comprova sua identidade.</p><p>Workspace: <strong>${htmlEscape(context.workspaceName ?? context.workspaceSlug)}</strong>. Acesso delegado a <strong>${htmlEscape(context.displayName)}</strong>, limitado às permissões atuais.</p><p>Retorno solicitado: <code>${htmlEscape(authorization.redirect_uri)}</code></p><p>Permissões de leitura:</p><ul>${authorization.scopes.map((scope) => `<li>${htmlEscape(scope)}</li>`).join("")}</ul><p>Não permite alterar o CRM ou enviar mensagens.</p><form method="post" action="${htmlEscape(request.nextUrl.pathname + request.nextUrl.search)}"><input type="hidden" name="consent_token" value="${htmlEscape(consent)}"><button name="decision" value="allow">Autorizar leitura</button><button name="decision" value="deny">Negar</button></form></main></body></html>`;
    return new NextResponse(body, { headers: browserHeaders });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError || error instanceof SessionExpiredError) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`, request.url));
    return oauthFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await rateLimitOAuth(request, "authorize");
    const authorization = await parseAuthorization(request.nextUrl.searchParams);
    const context = await authorizeContext(request);
    const form = await readOAuthForm(request);
    const service = getCrmMcpOAuthService();
    await service.validateConsent(uniqueParam(form, "consent_token")!, context, authorization);
    const redirect = new URL(authorization.redirect_uri);
    if (authorization.state) redirect.searchParams.set("state", authorization.state);
    redirect.searchParams.set("iss", getCrmMcpOAuthConfig().issuer);
    if (uniqueParam(form, "decision") !== "allow") redirect.searchParams.set("error", "access_denied");
    else redirect.searchParams.set("code", await service.createAuthorizationCode(context, authorization));
    // A 303 after this form is blocked by Chromium's form-action 'self' CSP.
    const destination = redirect.toString();
    const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${htmlEscape(destination)}"><title>Concluindo conexão</title></head><body><p>Concluindo conexão com o cliente autorizado…</p><a href="${htmlEscape(destination)}" rel="noreferrer">Continuar</a></body></html>`;
    return new NextResponse(body, { headers: { ...browserHeaders, "Referrer-Policy": "no-referrer", Pragma: "no-cache", Refresh: `0;url=${destination}` } });
  } catch (error) { return oauthFailure(error); }
}
