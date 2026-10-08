import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getGoogleCalendarService } from "@/modules/integrations/application/google-calendar-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getGoogleCalendarService().beginConnect(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
