import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getUnifiedActivityService } from "@/modules/activities/application/unified-activity-service";
import { getSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const [queue, metadata] = await Promise.all([getSalesGateService().getActivityQueue(context), getUnifiedActivityService().metadata(context)]);
    return NextResponse.json({ result: { ...queue, ...metadata } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    return NextResponse.json({ result: await getUnifiedActivityService().bulkCommand(context, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
