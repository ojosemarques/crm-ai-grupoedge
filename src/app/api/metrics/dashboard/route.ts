import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function searchInput(request: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    result[key] = values.length === 1 ? values[0]! : values;
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const input = searchInput(request);
    const view = request.nextUrl.searchParams.get("view");
    const result = view
      ? await getDashboardMetricsService().getDrilldown(context, input)
      : await getDashboardMetricsService().getScreen(context, input);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
