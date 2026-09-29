import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getMeetingService().getAgenda(context, {
      view: request.nextUrl.searchParams.get("view") ?? undefined,
      date: request.nextUrl.searchParams.get("date") ?? undefined,
      closerId: request.nextUrl.searchParams.get("closerId") ?? undefined,
    });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    const result = await getMeetingService().schedule(context, body);
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
