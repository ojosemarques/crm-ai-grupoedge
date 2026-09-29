import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { createExpiredSessionCookie } from "@/modules/auth/http/session-cookie";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("auth-password-change", `${context.userId}:${requestClientKey(request)}`, sensitiveEndpointPolicies.passwordChange);
    const input = changePasswordSchema.safeParse(await readLimitedJson(request, 16 * 1024));
    if (!input.success) {
      return NextResponse.json({ error: { message: "Revise as senhas informadas." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    await getAuthenticationService().changePassword(context, input.data.currentPassword, input.data.newPassword);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(createExpiredSessionCookie());
    return response;
  } catch (error) {
    return handleRouteError(error, request);
  }
}
