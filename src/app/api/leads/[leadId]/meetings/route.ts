import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LeadMeetingRouteContext = Readonly<{ params: Promise<{ leadId: string }> }>;

export async function GET(request: NextRequest, routeContext: LeadMeetingRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getMeetingService().getLeadMeetings(context, { leadId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
