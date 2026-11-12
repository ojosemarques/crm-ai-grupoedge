import { NextRequest, NextResponse } from "next/server";
import { startNativePublicAgenda } from "@/modules/marketing-forms/application/public-agenda-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit("native-public-agenda", requestClientKey(request), { limit: 5, windowMs: 60_000 });
    const receipt = await startNativePublicAgenda(await readLimitedJson(request, 1024));
    return NextResponse.json({ receipt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = handleRouteError(error, request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
