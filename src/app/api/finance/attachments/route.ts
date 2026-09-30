import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("finance-attachment", requestClientKey(request), sensitiveEndpointPolicies.paymentAction);
    const context = await requireApiAuthentication(request);
    const encodedName = request.headers.get("x-file-name") ?? "";
    let fileName = "";
    try { fileName = decodeURIComponent(encodedName); } catch { fileName = ""; }
    const result = await getFinanceService().addAttachment(context, {
      entryId: request.nextUrl.searchParams.get("entryId"),
      fileName,
      mimeType: request.headers.get("content-type"),
    }, await readLimitedBuffer(request, 10_485_760));
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
