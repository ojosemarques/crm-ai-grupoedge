import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCustomerSuccessService } from "@/modules/customer-success/application/customer-success-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    return NextResponse.json({ result: await getCustomerSuccessService().screen(context, raw) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = await request.json().catch(() => null);
    const action = z.object({ action: z.enum(["ASSIGN_PORTFOLIO", "CREATE_PLAN", "ASSESS_HEALTH"]), payload: z.unknown() }).parse(body);
    const service = getCustomerSuccessService();
    const result = action.action === "ASSIGN_PORTFOLIO" ? await service.assignPortfolio(context, action.payload) : action.action === "CREATE_PLAN" ? await service.createPlan(context, action.payload) : await service.assessHealth(context, action.payload);
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
