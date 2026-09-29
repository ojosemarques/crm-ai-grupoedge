import { NextRequest, NextResponse } from "next/server";

import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import {
  createExpiredSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/modules/auth/http/session-cookie";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    await getAuthenticationService().logout(
      request.cookies.get(SESSION_COOKIE_NAME)?.value,
    );

    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(createExpiredSessionCookie());
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
