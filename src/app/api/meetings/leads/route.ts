import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    await enforceRateLimit(
      "meeting-lead-search",
      `${context.workspaceId}:${context.memberId}:${requestClientKey(request)}`,
      { limit: 90, windowMs: 60_000 },
    );
    const result = await getMeetingService().searchLeadOptions(context, {
      query: request.nextUrl.searchParams.get("q") ?? "",
    });
    return NextResponse.json(
      { result },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
