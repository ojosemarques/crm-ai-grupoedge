import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMetaNativeService } from "@/modules/acquisition-api/application/meta-native-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ result: await getMetaNativeService().list(await requireApiAuthentication(request)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const input = z.object({ connectionId: z.string().uuid(), importToday: z.boolean().default(false) }).strict().parse(await readLimitedJson(request, 2048));
    return NextResponse.json({ result: await getMetaNativeService().sync(context, input.connectionId, input.importToday) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
