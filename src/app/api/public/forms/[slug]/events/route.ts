import { NextRequest, NextResponse } from "next/server";

import { getMarketingFormSubmissionService } from "@/modules/marketing-forms/application/marketing-form-submission-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await enforceRateLimit("marketing-form-events", `${slug}:${requestClientKey(request)}`, { limit: 120, windowMs: 60_000 });
    const result = await getMarketingFormSubmissionService().recordEvents(slug, await readLimitedJson(request, 48 * 1_024));
    return NextResponse.json({ result }, { status: 202, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
