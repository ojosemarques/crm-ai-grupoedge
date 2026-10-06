import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { oauthErrorResponse, uniqueParam } from "@/app/api/oauth/route-helpers";
import { AuthenticationRequiredError, SessionExpiredError } from "@/modules/auth/domain/auth-errors";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { getPolitizaiMcpPublicConfig } from "@/modules/prospecting/domain/politizai-mcp-config";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseRequest(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const name of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource"]) {
    raw[name] = uniqueParam(params, name)!;
  }
  const scope = uniqueParam(params, "scope", false);
  if (scope !== undefined) raw.scope = scope;
  const allowed = new Set([...Object.keys(raw), "scope"]);
  for (const name of params.keys()) {
    if (!allowed.has(name)) throw new OAuthError(OAuthErrorCode.InvalidRequest, `Parâmetro OAuth não suportado: ${name}.`);
  }
  return getPolitizaiMcpOAuthService().parseAuthorizationRequest(raw);
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function authorizeContext(request: NextRequest) {
  const context = await requireApiAuthentication(request);
  await getAuthorizationService().assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, {
    workspaceId: context.workspaceId,
    resourceType: "McpIntegration",
    resourceId: context.workspaceId,
  });
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const authorization = parseRequest(request.nextUrl.searchParams);
    const context = await authorizeContext(request);
    const scopeList = authorization.scopes.map((scope) => `<li><code>${htmlEscape(scope)}</code></li>`).join("");
    const action = htmlEscape(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Autorizar Dot Politizai</title><style>body{font-family:system-ui;background:#f4f5f7;color:#17202a;margin:0;padding:32px}.card{max-width:640px;margin:5vh auto;background:#fff;border:1px solid #dfe3e8;border-radius:16px;padding:28px;box-shadow:0 12px 40px #0001}h1{font-size:24px}button{border:0;border-radius:9px;padding:12px 18px;font-weight:700;cursor:pointer}.allow{background:#153a66;color:#fff}.deny{background:#edf0f3;margin-left:8px}</style></head><body><main class="card"><h1>Conectar o Dot à Politizai</h1><p><strong>${htmlEscape(context.displayName)}</strong>, o Dot poderá pesquisar e registrar políticos no workspace <strong>${htmlEscape(context.workspaceName ?? context.workspaceSlug)}</strong>.</p><p>Ele não terá acesso direto ao banco e não poderá enviar e-mails.</p><p>Escopos:</p><ul>${scopeList}</ul><form method="post" action="${action}"><button class="allow" name="decision" value="allow">Autorizar</button><button class="deny" name="decision" value="deny">Negar</button></form></main></body></html>`;
    return new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError || error instanceof SessionExpiredError) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));
    }
    return oauthErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const authorization = parseRequest(request.nextUrl.searchParams);
    const context = await authorizeContext(request);
    const form = await request.formData();
    const decision = form.get("decision");
    const redirect = new URL(authorization.redirect_uri);
    redirect.searchParams.set("state", authorization.state);
    redirect.searchParams.set("iss", getPolitizaiMcpPublicConfig().issuer.href.replace(/\/$/, ""));
    if (decision !== "allow") {
      redirect.searchParams.set("error", OAuthErrorCode.AccessDenied);
      return NextResponse.redirect(redirect, 303);
    }
    const code = await getPolitizaiMcpOAuthService().createAuthorizationCode(context, authorization);
    redirect.searchParams.set("code", code);
    return NextResponse.redirect(redirect, 303);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
