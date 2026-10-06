import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOpenDotRequestService } from "@/modules/prospecting/application/open-dot-request-service";
import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { OPEN_DOT_MAX_BODY_BYTES, type OpenDotScopeValue } from "@/modules/prospecting/domain/prospecting-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey } from "@/shared/core/http/request-hardening";
import type { Prisma } from "@/generated/prisma/client";

export async function signedOpenDotRoute(
  request: NextRequest,
  requiredScope: OpenDotScopeValue,
  handler: (
    transaction: Prisma.TransactionClient,
    principal: OpenDotPrincipal,
    body: unknown,
  ) => Promise<Readonly<{ status?: number; body: Record<string, unknown> }>>,
): Promise<NextResponse> {
  try {
    const claimedClientId = request.headers.get("x-open-dot-client-id") ?? "missing-client";
    await enforceRateLimit(
      `open-dot:${request.nextUrl.pathname}`,
      `${claimedClientId.slice(0, 64)}:${requestClientKey(request)}`,
      { limit: 120, windowMs: 60_000 },
    );
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (request.method !== "GET" && !contentType.includes("application/json")) {
      return NextResponse.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Envie application/json." } }, { status: 415 });
    }
    const rawBody = request.method === "GET" ? "" : (await readLimitedBuffer(request, OPEN_DOT_MAX_BODY_BYTES)).toString("utf8");
    let body: unknown = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: { code: "INVALID_JSON", message: "JSON inválido." } }, { status: 400 });
      }
    }
    const result = await getOpenDotRequestService().execute({
      method: request.method,
      path: request.nextUrl.pathname,
      rawBody,
      requiredScope,
      rawHeaders: {
        clientId: request.headers.get("x-open-dot-client-id"),
        timestamp: request.headers.get("x-open-dot-timestamp"),
        nonce: request.headers.get("x-open-dot-nonce"),
        signature: request.headers.get("x-open-dot-signature"),
        idempotencyKey: request.headers.get("idempotency-key"),
      },
      handler: async (transaction, principal) => {
        const response = await handler(transaction, principal, body);
        return { status: response.status ?? 200, body: response.body };
      },
    });
    return NextResponse.json(
      { ...result.body, idempotentReplay: result.idempotentReplay },
      { status: result.status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    return handleRouteError(error, request);
  }
}
