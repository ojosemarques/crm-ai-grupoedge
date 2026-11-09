import { NextRequest, NextResponse } from "next/server";
import { bookPublicAgenda, listPublicAgenda } from "@/modules/marketing-forms/application/public-agenda-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
type Context = { params: Promise<{ receipt: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await enforceRateLimit("public-agenda-list", requestClientKey(request), { limit: 30, windowMs: 60_000 });
    return NextResponse.json(await listPublicAgenda((await params).receipt), { headers });
  } catch (error) {
    const response = handleRouteError(error, request);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    await enforceRateLimit("public-agenda-book", requestClientKey(request), { limit: 10, windowMs: 60_000 });
    return NextResponse.json(await bookPublicAgenda((await params).receipt, await readLimitedJson(request, 1_024)), { headers });
  } catch (error) {
    const response = handleRouteError(error, request);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
