import { NextRequest } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { leadEntryResponse } from "@/modules/leads/http/lead-entry-route";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  enforceRateLimit,
  readLimitedJson,
  sensitiveEndpointPolicies,
} from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertLocalOnly(request);
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("lead-simulator", context.memberId, sensitiveEndpointPolicies.localLeadEntry);
    const result = await getLeadEntryService().simulate(
      await readLimitedJson(request, 64 * 1024),
      context,
    );
    return leadEntryResponse(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
