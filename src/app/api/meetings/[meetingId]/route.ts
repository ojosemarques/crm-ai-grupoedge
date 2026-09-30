import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MeetingRouteContext = Readonly<{ params: Promise<{ meetingId: string }> }>;

export async function GET(request: NextRequest, routeContext: MeetingRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { meetingId } = await routeContext.params;
    const result = await getMeetingService().getBriefing(context, { meetingId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, routeContext: MeetingRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { meetingId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    const action = z.object({ action: z.string() }).passthrough().safeParse(body);
    const transcriptPayload = action.success ? Object.fromEntries(Object.entries(action.data).filter(([key]) => key !== "action")) : {};
    const result = action.success && action.data.action === "RECORD_TRANSCRIPT"
      ? await getMeetingService().recordTranscript(context, { ...transcriptPayload, meetingId })
      : await getMeetingService().act(context, { ...(body && typeof body === "object" ? body : {}), meetingId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
