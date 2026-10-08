import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getGoogleCalendarService } from "@/modules/integrations/application/google-calendar-service";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const destination = new URL("/integracoes/calendario", process.env.APP_CANONICAL_URL ?? request.url);
  try {
    const context = await requireApiAuthentication(request);
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const providerError = request.nextUrl.searchParams.get("error");
    if (providerError || !state || !code) throw new ApplicationError("A autorização do Google foi cancelada.", { code: "GOOGLE_CALENDAR_AUTH_CANCELLED", statusCode: 400, expose: true });
    await getGoogleCalendarService().completeConnect(context, state, code);
    destination.searchParams.set("google", "connected");
  } catch (error) {
    destination.searchParams.set("google", "error");
    destination.searchParams.set("code", error instanceof ApplicationError ? error.code : "GOOGLE_CALENDAR_CALLBACK_FAILED");
  }
  return NextResponse.redirect(destination);
}
