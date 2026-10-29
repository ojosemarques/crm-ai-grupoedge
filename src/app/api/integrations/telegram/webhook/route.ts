import { NextResponse, type NextRequest } from "next/server";
import { createTelegramBindingService, verifyTelegramWebhookSecret } from "@/modules/integrations/application/telegram-lead-alert-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"));
    await enforceRateLimit("telegram-webhook", requestClientKey(request), { limit: 120, windowMs: 60000 });
    const result = await createTelegramBindingService({ database: getDatabaseClient(), now: () => new Date() }).receive(await readLimitedJson(request, 16384));
    return NextResponse.json({ accepted: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
