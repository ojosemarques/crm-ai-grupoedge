import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: RouteContext<"/api/marketing/forms/[formId]">) {
  try {
    const context = await requireApiAuthentication(request);
    const { formId } = await params;
    const service = getMarketingFormService();
    const [form, catalog] = await Promise.all([service.detail(context, formId), service.catalog(context)]);
    return NextResponse.json({ result: { form, catalog } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext<"/api/marketing/forms/[formId]">) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { formId } = await params;
    const result = await getMarketingFormService().updateDraft(context, formId, await readLimitedJson(request, 256 * 1024));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
