import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { getWebhookInboxService } from "@/modules/integrations/application/webhook-inbox-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";
import { MAX_WEBHOOK_BYTES } from "@/modules/integrations/domain/integration-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function readRawBody(request: Request) {
  const advertised = Number(request.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > MAX_WEBHOOK_BYTES) throw new ApplicationError("O webhook excede o limite de 256 KiB.", { code: "WEBHOOK_TOO_LARGE", statusCode: 413, expose: true });
  if (!request.body) return "";
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let size = 0; let result = "";
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); throw new ApplicationError("O webhook excede o limite de 256 KiB.", { code: "WEBHOOK_TOO_LARGE", statusCode: 413, expose: true }); } result += decoder.decode(chunk.value, { stream: true }); }
  return result + decoder.decode();
}
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string; connectionKey: string }> }) {
  try {
    assertLocalOnly(request);
    enforceLocalRateLimit("integration-webhook", requestClientKey(request), { limit: 60, windowMs: 60_000 });
    const { workspaceSlug, connectionKey } = await context.params;
    const rawBody = await readRawBody(request);
    const result = await getWebhookInboxService().receive({ workspaceSlug, connectionKey, rawBody, timestamp: request.headers.get("x-politizai-timestamp") ?? "", signature: request.headers.get("x-politizai-signature") ?? "" });
    return NextResponse.json({ result }, { status: result.idempotent ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
