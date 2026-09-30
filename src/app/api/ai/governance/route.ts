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
    if (!body || typeof body !== "object" || !("action" in body) || (body.action !== "INITIALIZE_COPILOT" && !("data" in body))) {
      throw new ApplicationError("Informe a ação de governança.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    const service = getAIGovernanceService();
    const data = "data" in body ? body.data : undefined;
    const result = body.action === "INITIALIZE_COPILOT"
      ? await service.initializeCopilot(context)
      : body.action === "EVALUATE" && data && typeof data === "object" && "useCaseVersionId" in data && typeof data.useCaseVersionId === "string"
        ? await service.runEvaluation(context, data.useCaseVersionId)
        : await service.transition(context, data);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
