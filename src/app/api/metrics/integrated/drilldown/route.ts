import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMetricsService } from "@/modules/metrics/application/metrics-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const filterKeys = ["sdrMemberIds", "closerMemberIds", "teamIds", "sourceIds", "campaignIds", "creativeIds", "priorityCodes", "productIds", "pipelineIds", "stageIds", "channels", "municipality", "stateCodes", "politicalRoles", "cadenceStepKeys", "executionModes"] as const;

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const to = request.nextUrl.searchParams.get("to") ?? new Date().toISOString();
    const from = request.nextUrl.searchParams.get("from") ?? new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString();
    const metricId = request.nextUrl.searchParams.get("metricId") ?? "";
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const query = { from, to, filters: Object.fromEntries(filterKeys.map((key) => [key, request.nextUrl.searchParams.getAll(key)])) };
    const result = await getMetricsService().getIntegratedDrilldown(context, { metricId, query, ...(cursor ? { cursor } : {}), limit });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
