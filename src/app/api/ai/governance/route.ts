import { NextRequest, NextResponse } from "next/server";

import { getAIGovernanceService } from "@/modules/ai/application/ai-governance-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getAIGovernanceService().getScreen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("ai-governance", context.memberId, sensitiveEndpointPolicies.artificialIntelligence);
    const body: unknown = await readLimitedJson(request, 64 * 1024);
    if (!body || typeof body !== "object" || !("action" in body) || !("data" in body)) {
      throw new ApplicationError("Informe a ação de governança.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    const service = getAIGovernanceService();
    const result = body.action === "EVALUATE" && body.data && typeof body.data === "object" && "useCaseVersionId" in body.data && typeof body.data.useCaseVersionId === "string"
      ? await service.runEvaluation(context, body.data.useCaseVersionId)
      : await service.transition(context, body.data);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
