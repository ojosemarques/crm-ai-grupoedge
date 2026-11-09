import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const runtime = "nodejs";
const paramsSchema = z.object({ accountId: z.string().uuid(), opportunityId: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string; opportunityId: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("customer-schedule", `${context.workspaceId}:${context.memberId}`, sensitiveEndpointPolicies.operations);
    const { accountId, opportunityId } = paramsSchema.parse(await params);
    const payload = await readLimitedJson(request, 16 * 1024);
    await getOpportunityService().getCustomerSale(context, accountId, opportunityId);
    const result = await getPaymentService().reallocateCustomerSchedule(context, accountId, opportunityId, payload);
    return NextResponse.json({ result });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
