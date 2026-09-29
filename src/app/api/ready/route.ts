import { NextResponse } from "next/server";

import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { checkReadiness } from "@/shared/core/health/health-check";
import { correlationResponseHeaders, resolveCorrelationId } from "@/shared/core/http/correlation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const report = await checkReadiness();
    const correlationId = resolveCorrelationId(request.headers);
    return NextResponse.json(
      report,
      {
        status: report.ready ? 200 : 503,
        headers: correlationResponseHeaders(correlationId),
      },
    );
  } catch (error) {
    return handleRouteError(error, request);
  }
}
