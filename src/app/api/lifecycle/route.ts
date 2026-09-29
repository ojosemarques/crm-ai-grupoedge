import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getLifecycleService().getJourney(context, { entityType: request.nextUrl.searchParams.get("entityType"), entityId: request.nextUrl.searchParams.get("entityId") }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    return NextResponse.json({ result: await getLifecycleService().transition(context, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
