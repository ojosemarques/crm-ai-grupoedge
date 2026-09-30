import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getInstagramService } from "@/modules/integrations/application/instagram-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.object({ action: z.literal("SIMULATE_INBOUND"), data: z.unknown() }).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getInstagramService().screen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const command = commandSchema.parse(await readLimitedJson(request, 64 * 1024));
    return NextResponse.json({ result: await getInstagramService().simulateInbound(context, command.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
