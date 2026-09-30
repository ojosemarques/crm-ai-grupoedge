import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getStrategyFunnelService } from "@/modules/marketing/application/strategy-funnel-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("UPDATE"), id: z.string().uuid(), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("ARCHIVE"), id: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getStrategyFunnelService().screen(context, Object.fromEntries(request.nextUrl.searchParams.entries())) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = bodySchema.parse(await readLimitedJson(request, 128 * 1024));
    const service = getStrategyFunnelService();
    const result = body.action === "CREATE" ? await service.create(context, body.payload) : body.action === "UPDATE" ? await service.update(context, body.id, body.payload) : await service.archive(context, body.id, body.expectedRevision);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
