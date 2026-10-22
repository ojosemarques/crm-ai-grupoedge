import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMarketingFormReportingService } from "@/modules/marketing-forms/application/marketing-form-reporting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getMarketingFormReportingService().statistics(context, (await params).formId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleRouteError(error, request); }
}
