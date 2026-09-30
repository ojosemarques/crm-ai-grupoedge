import { NextRequest, NextResponse } from "next/server";

import { getTransactionalCheckoutService } from "@/modules/payments/application/transactional-checkout-service";
import { CHECKOUT_MAX_WEBHOOK_BYTES } from "@/modules/payments/domain/transactional-checkout-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit("transactional-checkout-webhook", requestClientKey(request), sensitiveEndpointPolicies.paymentWebhook);
    const rawBody = await readLimitedBuffer(request, CHECKOUT_MAX_WEBHOOK_BYTES);
    const result = await getTransactionalCheckoutService().ingestSignedWebhook(rawBody, request.headers.get("x-politizai-checkout-timestamp"), request.headers.get("x-politizai-checkout-signature"));
    return NextResponse.json({ result }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
