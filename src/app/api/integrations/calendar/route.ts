import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCalendarService } from "@/modules/integrations/application/calendar-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.object({
  action: z.enum(["SYNC_MEETING", "REPLAY", "CONFIGURE_LOCAL", "PAUSE", "RESUME", "RESOLVE_CONFLICT"]),
  data: z.unknown(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getCalendarService().screen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("calendar", requestClientKey(request), sensitiveEndpointPolicies.calendar);
    const context = await requireApiAuthentication(request);
    const command = commandSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getCalendarService();
    const result = command.action === "SYNC_MEETING" ? await service.enqueueMeetingSync(context, command.data)
      : command.action === "CONFIGURE_LOCAL" ? await service.configureLocal(context, command.data)
      : command.action === "REPLAY" ? await service.replay(context, z.object({ eventId: z.string().uuid() }).parse(command.data).eventId)
      : command.action === "RESOLVE_CONFLICT" ? await service.resolveConflict(context, ...(() => { const input = z.object({ conflictId: z.string().uuid(), resolution: z.enum(["KEEP_CRM", "APPLY_EXTERNAL"]), reason: z.string() }).parse(command.data); return [input.conflictId, input.resolution, input.reason] as const; })())
      : await service.setPaused(context, command.action === "PAUSE", z.object({ revision: z.number().int().positive() }).parse(command.data).revision);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
