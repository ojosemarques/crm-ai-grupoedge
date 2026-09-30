import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ opportunityId: string }> }>;

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { opportunityId } = await routeContext.params;
    const result = await getSalesGateService().getScreen(context, opportunityId);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { opportunityId } = await routeContext.params;
    const result = await getSalesGateService().command(context, opportunityId, await request.json().catch(() => null));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
