import { NextRequest, NextResponse } from "next/server";

import { getLeadIntelligenceService } from "@/modules/ai/application/lead-intelligence-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import {
  enforceRateLimit,
  readLimitedJson,
  sensitiveEndpointPolicies,
} from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IntelligenceRouteContext = Readonly<{ params: Promise<{ leadId: string }> }>;

export async function GET(request: NextRequest, routeContext: IntelligenceRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getLeadIntelligenceService().getScreen(context, { leadId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, routeContext: IntelligenceRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    await enforceRateLimit("lead-intelligence", context.memberId, sensitiveEndpointPolicies.artificialIntelligence);
    const body: unknown = await readLimitedJson(request, 256 * 1024);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação de inteligência.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const data = "data" in body && body.data && typeof body.data === "object" ? body.data : {};
    const service = getLeadIntelligenceService();
    const result = body.action === "RUN"
      ? await service.run(context, { ...data, leadId })
      : body.action === "REVIEW"
        ? await service.review(context, { ...data, leadId })
        : (() => {
            throw new ApplicationError("Ação de inteligência desconhecida.", {
              code: "INVALID_INPUT",
              statusCode: 400,
              expose: true,
            });
          })();
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
