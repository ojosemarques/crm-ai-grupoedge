import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMarketingFormAdvertisingSyncService } from "@/modules/marketing-forms/application/marketing-form-advertising-sync-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> },
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { formId } = await params;
    const result = await getMarketingFormAdvertisingSyncService().run(
      context,
      formId,
      await readLimitedJson(request, 4 * 1024),
    );
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
