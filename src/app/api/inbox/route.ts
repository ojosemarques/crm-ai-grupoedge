import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandEnvelope = z.object({ action: z.string().trim().min(1), data: z.unknown() }).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    return NextResponse.json({ result: await getOmnichannelService().getInbox(context, raw) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = commandEnvelope.parse(await readLimitedJson(request, 64 * 1024));
    const service = getOmnichannelService();
    const result = body.action === "RECEIVE_LOCAL"
      ? await service.receiveLocal(context, body.data)
      : body.action === "COMPOSE_AND_ENQUEUE"
        ? await service.composeAndEnqueue(context, body.data)
        : body.action === "SIMULATE_DELIVERY"
          ? await service.simulateDelivery(context, body.data)
          : body.action === "COMMAND"
            ? await service.command(context, body.data)
            : body.action === "SAVE_TEMPLATE"
              ? await service.saveTemplate(context, body.data)
              : null;
    if (!result) return NextResponse.json({ error: { code: "UNKNOWN_ACTION", message: "Ação de inbox não reconhecida." } }, { status: 400 });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
