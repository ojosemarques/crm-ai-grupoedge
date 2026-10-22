import { NextRequest, NextResponse } from "next/server";

import { getMarketingFormSubmissionService } from "@/modules/marketing-forms/application/marketing-form-submission-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey } from "@/shared/core/http/request-hardening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await enforceRateLimit("marketing-form-submit", `${slug}:${requestClientKey(request)}`, { limit: 20, windowMs: 60_000 });
    const result = await getMarketingFormSubmissionService().submit(slug, await readLimitedJson(request, 128 * 1_024));
    return NextResponse.json({ result }, { status: 201, headers });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
