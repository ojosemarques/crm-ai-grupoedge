import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import { assertSameOrigin, getRequestMetadata } from "@/modules/auth/http/request-security";
import { createSessionCookie, SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("company-switch", context.userId, { limit: 30, windowMs: 60_000 });
    const input = z.object({ workspaceId: z.string().uuid() }).strict().parse(await readLimitedJson(request, 4096));
    const result = await getAuthenticationService().switchWorkspace(request.cookies.get(SESSION_COOKIE_NAME)?.value, input.workspaceId, getRequestMetadata(request));
    const response = NextResponse.json({ redirectTo: "/", workspaceId: result.context.workspaceId }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(createSessionCookie(result.token, result.expiresAt));
    return response;
  } catch (error) { return handleRouteError(error, request); }
}
