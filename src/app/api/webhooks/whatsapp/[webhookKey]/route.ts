import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getWhatsAppService } from "@/modules/integrations/application/whatsapp-service";
import { WHATSAPP_MAX_WEBHOOK_BYTES } from "@/modules/integrations/domain/whatsapp-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ webhookKey: string }> }>;

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const { webhookKey } = await routeContext.params;
    const challenge = await getWhatsAppService().verifyWebhookChallenge(
      webhookKey,
      request.nextUrl.searchParams.get("hub.mode"),
      request.nextUrl.searchParams.get("hub.verify_token"),
      request.nextUrl.searchParams.get("hub.challenge"),
    );
    if (!challenge) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(challenge, { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) { return handleRouteError(error, request); }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    await enforceRateLimit("whatsapp-webhook", requestClientKey(request), sensitiveEndpointPolicies.whatsAppWebhook);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) return NextResponse.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Envie o webhook como application/json." } }, { status: 415 });
    const { webhookKey } = await routeContext.params;
    const rawBody = await readLimitedBuffer(request, WHATSAPP_MAX_WEBHOOK_BYTES);
    const result = await getWhatsAppService().acceptWebhook(webhookKey, rawBody, request.headers.get("x-hub-signature-256"));
    return NextResponse.json({ received: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
