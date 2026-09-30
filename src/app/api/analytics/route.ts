import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ result: await getAnalyticsBuilderService().screen(await requireApiAuthentication(request)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
