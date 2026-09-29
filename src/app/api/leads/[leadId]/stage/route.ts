import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StageRouteContext = Readonly<{
  params: Promise<{ leadId: string }>;
}>;

export async function GET(request: NextRequest, routeContext: StageRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getPreSalesPipelineService().getLeadState(context, { leadId });
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, routeContext: StageRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ApplicationError("Informe os dados da transição.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const result = await getPreSalesPipelineService().transition(context, {
      ...body,
      leadId,
    });
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
