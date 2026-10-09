import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createMillionSendWebhookService } from "@/modules/integrations/application/millionsend-webhook-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit("millionsend-webhook", requestClientKey(request), { limit: 240, windowMs: 60_000 });
    const rawBody = (await readLimitedBuffer(request, 256 * 1024)).toString("utf8");
    const result = await createMillionSendWebhookService().ingest({
      rawBody,
      id: request.headers.get("webhook-id") ?? request.headers.get("svix-id"),
      timestamp: request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp"),
      signature: request.headers.get("webhook-signature") ?? request.headers.get("svix-signature"),
    });
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
