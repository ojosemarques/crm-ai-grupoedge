import { NextRequest } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMarketingFormReportingService } from "@/modules/marketing-forms/application/marketing-form-reporting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("marketing-form-export", `${context.workspaceId}:${context.memberId}`, { limit: 10, windowMs: 60_000 });
    const result = await getMarketingFormReportingService().csv(context, (await params).formId, Object.fromEntries(request.nextUrl.searchParams));
    return new Response(result.csv, { headers: { "Cache-Control": "private, no-store", "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleRouteError(error, request); }
}
