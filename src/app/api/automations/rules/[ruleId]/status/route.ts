import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ ruleId: string }> }>;

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { ruleId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    const result = await getAutomationEngineService().changeRuleStatus(context, {
      ...(body && typeof body === "object" ? body : {}),
      ruleId,
    });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
