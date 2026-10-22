import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getRealtimeDashboardService,
  readRealtimeBearer,
  realtimeTokenHash,
} from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  enforceRateLimit,
  requestClientKey,
} from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const publicHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    await enforceRateLimit(
      "public-realtime-dashboard",
      `${realtimeTokenHash(authorization)}:${requestClientKey(request)}`,
      { limit: 120, windowMs: 60_000 },
    );
    const token = readRealtimeBearer(authorization);
    const result = await getRealtimeDashboardService().publicSnapshot(token);
    return NextResponse.json({ result }, { headers: publicHeaders });
  } catch (error) {
    const response = handleRouteError(error, request);
    for (const [key, value] of Object.entries(publicHeaders)) response.headers.set(key, value);
    return response;
  }
}
