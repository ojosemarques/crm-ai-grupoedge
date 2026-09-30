import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getConsultativeRevenueIndicatorService } from "@/modules/revenue/application/consultative-revenue-indicator-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const to = new Date(request.nextUrl.searchParams.get("to") ?? Date.now());
    const from = new Date(request.nextUrl.searchParams.get("from") ?? to.getTime() - 30 * 86_400_000);
    const result = await getConsultativeRevenueIndicatorService().build(context, from, to);
    return NextResponse.json({ result });
  } catch (error) {
    return handleRouteError(error);
  }
}
