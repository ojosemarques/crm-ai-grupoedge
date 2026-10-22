import { NextResponse } from "next/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { oauthErrorResponse } from "@/app/api/oauth/route-helpers";
import { getCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { uniqueParam } from "@/app/api/oauth/route-helpers";
import { readLimitedBuffer, enforceRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";

export const oauthHeaders = { "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" };
export function oauthFailure(error: unknown) {
  const response = oauthErrorResponse(error);
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
export function oauthOptions() { return new NextResponse(null, { status: 204, headers: { ...oauthHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } }); }
export async function rateLimitOAuth(request: Request, operation: "register" | "token" | "revoke" | "authorize") {
  await enforceRateLimit(`crm-oauth-${operation}`, requestClientKey(request), { limit: operation === "register" ? 20 : 60, windowMs: 60_000 });
}
export async function readOAuthForm(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/x-www-form-urlencoded") throw new OAuthError(OAuthErrorCode.InvalidRequest, "Use application/x-www-form-urlencoded.");
  return new URLSearchParams((await readLimitedBuffer(request, 16 * 1024)).toString("utf8"));
}
export async function parseAuthorization(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const name of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "resource", "state", "scope"]) {
    const value = uniqueParam(params, name, !["state", "scope"].includes(name));
    if (value !== undefined) raw[name] = value;
  }
  return getCrmMcpOAuthService().parseAuthorizationRequest(raw);
}
export function htmlEscape(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
