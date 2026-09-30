import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const requestSchema = z.object({ action: z.enum(["PREVIEW", "CONFIRM"]), payload: z.record(z.string(), z.unknown()) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("payment-receipt", requestClientKey(request), sensitiveEndpointPolicies.paymentAction);
    const context = await requireApiAuthentication(request);
    const body = requestSchema.parse(await readLimitedJson(request, 32 * 1024));
    const input = { ...body.payload, invoiceId: (await params).invoiceId };
    const service = getPaymentService();
    const result = body.action === "PREVIEW" ? await service.previewReceipt(context, input) : await service.recordReceipt(context, input);
    return NextResponse.json({ result: paymentJsonSafe(result) });
  } catch (error) { return handleRouteError(error); }
}
