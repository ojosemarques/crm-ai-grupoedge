import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLeadListService } from "@/modules/leads/application/lead-list-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SavedViewRouteContext = Readonly<{
  params: Promise<{ savedViewId: string }>;
}>;

export async function DELETE(
  request: NextRequest,
  routeContext: SavedViewRouteContext,
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { savedViewId } = await routeContext.params;
    const result = await getLeadListService().deleteSavedView(
      context,
      savedViewId,
    );
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
