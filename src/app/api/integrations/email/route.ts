import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getEmailService } from "@/modules/integrations/application/email-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.object({ action: z.enum(["CONFIGURE_LOCAL", "PAUSE", "RESUME", "SIMULATE_INBOUND", "SIMULATE_STATUS", "APPLY_SUPPRESSION"]), data: z.unknown() }).strict();

export async function GET(request: NextRequest) {
  try { const context = await requireApiAuthentication(request); return NextResponse.json({ result: await getEmailService().screen(context) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const command = commandSchema.parse(await readLimitedJson(request, 96 * 1024));
    const service = getEmailService();
    const result = command.action === "CONFIGURE_LOCAL" ? await service.configureLocal(context, command.data)
      : command.action === "SIMULATE_INBOUND" ? await service.simulateInbound(context, command.data)
      : command.action === "SIMULATE_STATUS" ? await service.simulateStatus(context, command.data)
      : command.action === "APPLY_SUPPRESSION" ? await service.applyLocalSuppression(context, command.data)
      : await service.setPaused(context, command.action === "PAUSE", z.object({ revision: z.number().int().positive() }).parse(command.data).revision);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
