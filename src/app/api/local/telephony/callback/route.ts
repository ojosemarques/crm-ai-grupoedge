import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getTelephonyService } from "@/modules/integrations/application/telephony-service";
import { TELEPHONY_MAX_CALLBACK_BYTES } from "@/modules/integrations/domain/telephony-contracts";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertLocalOnly(request);
    enforceLocalRateLimit("telephony-callback", requestClientKey(request), sensitiveEndpointPolicies.telephonyCallback);
    const workspaceId = z.string().uuid().parse(request.headers.get("x-politizai-workspace-id"));
    const rawBody = await readLimitedBuffer(request, TELEPHONY_MAX_CALLBACK_BYTES);
    const result = await getTelephonyService().ingestSignedLocalCallback(workspaceId, rawBody, request.headers.get("x-politizai-telephony-signature"));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
