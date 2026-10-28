import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { realtimeDashboardFrontSchema } from "@/modules/realtime-dashboard/domain/realtime-dashboard-front";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actionSchema = z.object({
  action: z.enum(["ROTATE", "REVOKE"]),
}).strict();

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const front = realtimeDashboardFrontSchema.parse(request.nextUrl.searchParams.get("front") ?? undefined);
    const result = await getRealtimeDashboardService().screen(context, front);
    return NextResponse.json({ result }, { headers: noStoreHeaders });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = actionSchema.parse(await readLimitedJson(request, 1_024));
    const service = getRealtimeDashboardService();
    const result = body.action === "ROTATE"
      ? await service.rotate(
        context,
        process.env.APP_CANONICAL_URL ?? request.nextUrl.origin,
      )
      : await service.revoke(context);
    return NextResponse.json({ result }, { headers: noStoreHeaders });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
