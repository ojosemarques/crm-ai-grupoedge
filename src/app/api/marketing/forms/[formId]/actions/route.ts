import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: RouteContext<"/api/marketing/forms/[formId]/actions">) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { formId } = await params;
    const result = await getMarketingFormService().action(context, formId, await readLimitedJson(request, 32 * 1024));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
