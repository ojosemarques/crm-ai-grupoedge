import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getOpportunityService().getPipelineScreen(context, {
      pipelineId: request.nextUrl.searchParams.get("pipelineId") || undefined,
      closerId: request.nextUrl.searchParams.get("closerId") || undefined,
      productId: request.nextUrl.searchParams.get("productId") || undefined,
      stageCode: request.nextUrl.searchParams.get("stageCode") || undefined,
      from: request.nextUrl.searchParams.get("from") || undefined,
      to: request.nextUrl.searchParams.get("to") || undefined,
    });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    const result = await getOpportunityService().create(context, body);
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
