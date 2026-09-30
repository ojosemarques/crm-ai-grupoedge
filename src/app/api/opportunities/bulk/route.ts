import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOpportunityBulkService } from "@/modules/pipeline-templates/application/opportunity-bulk-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const result = await getOpportunityBulkService().preview(await requireApiAuthentication(request), await request.json().catch(() => null));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const result = await getOpportunityBulkService().execute(await requireApiAuthentication(request), await request.json().catch(() => null));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
