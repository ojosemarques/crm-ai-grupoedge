import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMarketingFormReportingService } from "@/modules/marketing-forms/application/marketing-form-reporting-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ formId: string; receiptId: string }> }) {
  try {
    const context = await requireApiAuthentication(request);
    const { formId, receiptId } = await params;
    const result = await getMarketingFormReportingService().detail(context, formId, receiptId);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleRouteError(error, request); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ formId: string; receiptId: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { formId, receiptId } = await params;
    const result = await getMarketingFormReportingService().remove(context, formId, receiptId);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleRouteError(error, request); }
}
