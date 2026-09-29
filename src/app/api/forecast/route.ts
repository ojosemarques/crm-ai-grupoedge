import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getForecastService } from "@/modules/forecast/application/forecast-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_CYCLE"), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("SUBMIT"), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("CONSOLIDATE"), payload: z.unknown() }).strict(),
]);
function jsonSafe(value: unknown) { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getForecastService().screen(context, Object.fromEntries(request.nextUrl.searchParams.entries())) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = requestSchema.parse(await readLimitedJson(request, 256 * 1024));
    const service = getForecastService();
    const result = body.action === "CREATE_CYCLE" ? await service.createCycle(context, body.payload) : body.action === "SUBMIT" ? await service.submit(context, body.payload) : await service.consolidate(context, body.payload);
    return NextResponse.json({ result: jsonSafe(result) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
