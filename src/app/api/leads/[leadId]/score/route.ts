import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ScoreRouteContext = Readonly<{ params: Promise<{ leadId: string }> }>;

export async function GET(request: NextRequest, routeContext: ScoreRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getLeadScoringService().getScore(context, { leadId });
    return NextResponse.json({ result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, routeContext: ScoreRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação de pontuação.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const data = "data" in body && body.data && typeof body.data === "object" ? body.data : {};
    const service = getLeadScoringService();
    const result = body.action === "OVERRIDE"
      ? await service.override(context, { ...data, leadId })
      : body.action === "RECALCULATE"
        ? await service.recalculate(context, { ...data, leadId })
        : (() => {
            throw new ApplicationError("Ação de pontuação desconhecida.", {
              code: "INVALID_INPUT",
              statusCode: 400,
              expose: true,
            });
          })();
    return NextResponse.json({ result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
