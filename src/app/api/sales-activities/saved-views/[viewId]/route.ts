import { NextRequest, NextResponse } from "next/server";
import { getUnifiedActivityService } from "@/modules/activities/application/unified-activity-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: NextRequest, routeContext: Readonly<{ params: Promise<{ viewId: string }> }>) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { viewId } = await routeContext.params;
    return NextResponse.json({ result: await getUnifiedActivityService().deleteSavedView(context, viewId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
