import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getTransactionalCheckoutService } from "@/modules/payments/application/transactional-checkout-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ checkoutId: string }> }) {
  try {
    const auth = await requireApiAuthentication(request);
    return NextResponse.json({ result: paymentJsonSafe(await getTransactionalCheckoutService().detail(auth, (await context.params).checkoutId)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ checkoutId: string }> }) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("transactional-checkout", requestClientKey(request), sensitiveEndpointPolicies.paymentAction);
    const auth = await requireApiAuthentication(request);
    const result = await getTransactionalCheckoutService().act(auth, (await context.params).checkoutId, await request.json().catch(() => null));
    return NextResponse.json({ result: paymentJsonSafe(result) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
