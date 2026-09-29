import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCustomerSuccessService } from "@/modules/customer-success/application/customer-success-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { planId } = await params;
    return NextResponse.json({ result: await getCustomerSuccessService().actOnPlan(context, planId, await request.json().catch(() => null)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
