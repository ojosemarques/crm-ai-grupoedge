import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getLeadListService } from "@/modules/leads/application/lead-list-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const result = await getLeadListService().getScreen(context, query);
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
