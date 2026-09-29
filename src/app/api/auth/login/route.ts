import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import { InvalidAuthenticationInputError } from "@/modules/auth/domain/auth-errors";
import {
  assertSameOrigin,
  getRequestMetadata,
} from "@/modules/auth/http/request-security";
import { createSessionCookie } from "@/modules/auth/http/session-cookie";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  clearRateLimit,
  enforceRateLimit,
  readLimitedJson,
  requestClientKey,
  sensitiveEndpointPolicies,
} from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loginSchema = z.object({
  workspace: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const clientKey = requestClientKey(request);
    await enforceRateLimit(
      "auth-login",
      clientKey,
      sensitiveEndpointPolicies.login,
    );

    const parsed = loginSchema.safeParse(await readLimitedJson(request, 16 * 1024));
    if (!parsed.success) {
      throw new InvalidAuthenticationInputError();
    }

    const result = await getAuthenticationService().login({
      workspaceSlug: parsed.data.workspace,
      email: parsed.data.email,
      password: parsed.data.password,
      request: getRequestMetadata(request),
    });
    await clearRateLimit("auth-login", clientKey);
    const response = NextResponse.json(
      {
        session: {
          expiresAt: result.expiresAt.toISOString(),
          user: {
            displayName: result.context.displayName,
            role: result.context.roleName,
          },
          workspace: {
            slug: result.context.workspaceSlug,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(createSessionCookie(result.token, result.expiresAt));
    return response;
  } catch (error) {
    return handleRouteError(error, request);
  }
}
