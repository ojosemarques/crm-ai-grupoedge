import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { resolveCorrelationId } from "@/shared/core/http/correlation";
import { buildContentSecurityPolicy } from "@/shared/core/security/security-headers";

const PUBLIC_ROUTES = new Set(["/login", "/acesso-negado", "/sessao-expirada"]);

export function proxy(request: NextRequest): NextResponse {
  const correlationId = resolveCorrelationId(request.headers);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("Content-Security-Policy", policy);

  const remote = process.env.APP_ENV === "staging" || process.env.APP_ENV === "production";
  const requestedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")
    ?? request.nextUrl.host;
  const trustedHosts = new Set((process.env.APP_TRUSTED_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean));

  const apiRoute = request.nextUrl.pathname.startsWith("/api/");
  const response = remote && !trustedHosts.has(requestedHost)
    ? new NextResponse("Host não permitido.", { status: 421 })
    : !apiRoute && !PUBLIC_ROUTES.has(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE_NAME)
      ? NextResponse.redirect(new URL("/login", request.url))
      : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Correlation-Id", correlationId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
