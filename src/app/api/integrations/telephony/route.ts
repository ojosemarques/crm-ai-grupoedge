import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getTelephonyService } from "@/modules/integrations/application/telephony-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.object({
  action: z.enum(["START_OUTBOUND", "CANCEL", "DISPOSITION", "REPLAY", "CONFIGURE_LOCAL", "PAUSE", "RESUME"]),
  data: z.unknown(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getTelephonyService().screen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("telephony", requestClientKey(request), sensitiveEndpointPolicies.telephony);
    const context = await requireApiAuthentication(request);
    const command = commandSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getTelephonyService();
    const result = command.action === "START_OUTBOUND" ? await service.startOutbound(context, command.data)
      : command.action === "DISPOSITION" ? await service.setDisposition(context, command.data)
      : command.action === "CONFIGURE_LOCAL" ? await service.configureLocal(context, command.data)
      : command.action === "CANCEL" ? await service.cancel(context, z.object({ callId: z.string().uuid() }).parse(command.data).callId)
      : command.action === "REPLAY" ? await service.replay(context, z.object({ callId: z.string().uuid() }).parse(command.data).callId)
      : await service.setPaused(context, command.action === "PAUSE", z.object({ revision: z.number().int().positive() }).parse(command.data).revision);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
