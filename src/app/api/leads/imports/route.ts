import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLeadCsvImportService } from "@/modules/leads/application/lead-csv-import-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  enforceRateLimit,
  readLimitedJson,
  sensitiveEndpointPolicies,
} from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("csv-execute", context.memberId, sensitiveEndpointPolicies.csvImport);
    const result = await getLeadCsvImportService().execute(
      await readLimitedJson(request, 3 * 1024 * 1024),
      context,
    );
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
