import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getTransactionalCheckoutService } from "@/modules/payments/application/transactional-checkout-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: paymentJsonSafe(await getTransactionalCheckoutService().list(context)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("transactional-checkout", requestClientKey(request), sensitiveEndpointPolicies.paymentAction);
    const context = await requireApiAuthentication(request);
    const result = await getTransactionalCheckoutService().create(context, await request.json().catch(() => null));
    return NextResponse.json({ result: paymentJsonSafe(result) }, { status: result.idempotent ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
