import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getDailyGoalService } from "@/modules/goals/application/daily-goal-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const result = await getDailyGoalService().save(context, await readLimitedJson(request, 32 * 1024));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
