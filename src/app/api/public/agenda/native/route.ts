import { NextRequest, NextResponse } from "next/server";
import { listNativePublicAgenda, submitNativePublicAgenda } from "@/modules/marketing-forms/application/public-agenda-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit("native-public-agenda-list", requestClientKey(request), { limit: 30, windowMs: 60_000 });
    return NextResponse.json(await listNativePublicAgenda(), { headers });
  } catch (error) {
    const response = handleRouteError(error, request);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit("native-public-agenda", requestClientKey(request), { limit: 5, windowMs: 60_000 });
    return NextResponse.json(await submitNativePublicAgenda(await readLimitedJson(request, 1024)), { headers });
  } catch (error) {
    const response = handleRouteError(error, request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
