import { NextRequest } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { leadEntryResponse } from "@/modules/leads/http/lead-entry-route";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const payload = await readLimitedJson(request, 64 * 1024);
    const result = await getLeadEntryService().createManual(payload, context);
    return leadEntryResponse(result, result.outcome === "CREATED" ? 201 : 200);
  } catch (error) {
    return handleRouteError(error);
  }
}
