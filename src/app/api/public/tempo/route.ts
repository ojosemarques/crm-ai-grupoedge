import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { realtimeDashboardFrontSchema } from "@/modules/realtime-dashboard/domain/realtime-dashboard-front";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const publicHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit("public-realtime-tv", requestClientKey(request), { limit: 120, windowMs: 60_000 });
    const front = realtimeDashboardFrontSchema.parse(request.nextUrl.searchParams.get("front") ?? undefined);
    const result = await getRealtimeDashboardService().publicTvSnapshot(front);
    return NextResponse.json({ result }, { headers: publicHeaders });
  } catch (error) {
    const response = handleRouteError(error, request);
    for (const [key, value] of Object.entries(publicHeaders)) response.headers.set(key, value);
    return response;
  }
}
