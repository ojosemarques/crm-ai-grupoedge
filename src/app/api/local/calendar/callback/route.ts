import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCalendarService } from "@/modules/integrations/application/calendar-service";
import { CALENDAR_MAX_CALLBACK_BYTES } from "@/modules/integrations/domain/calendar-contracts";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertLocalOnly(request);
    enforceLocalRateLimit("calendar-callback", requestClientKey(request), sensitiveEndpointPolicies.calendarCallback);
    const workspaceId = z.string().uuid().parse(request.headers.get("x-politizai-workspace-id"));
    const rawBody = await readLimitedBuffer(request, CALENDAR_MAX_CALLBACK_BYTES);
    const result = await getCalendarService().ingestSignedLocalCallback(
      workspaceId,
      rawBody,
      request.headers.get("x-politizai-calendar-timestamp"),
      request.headers.get("x-politizai-calendar-signature"),
    );
    return NextResponse.json({ result }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
