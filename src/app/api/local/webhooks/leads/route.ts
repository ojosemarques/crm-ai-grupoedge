import { NextRequest } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLocalLeadWebhookService } from "@/modules/leads/application/local-lead-webhook-service";
import { leadEntryResponse } from "@/modules/leads/http/lead-entry-route";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  enforceLocalRateLimit,
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
    enforceLocalRateLimit("local-webhook", context.memberId, sensitiveEndpointPolicies.localLeadEntry);
    const result = await getLocalLeadWebhookService().receive(
      await readLimitedJson(request, 256 * 1024),
      context,
    );
    return leadEntryResponse(result, result.idempotentReplay ? 200 : 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
