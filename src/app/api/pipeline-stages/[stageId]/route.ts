import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ stageId: string }> }>;

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { stageId } = await routeContext.params;
    const query = request.nextUrl.searchParams;
    const result = await getPreSalesPipelineService().getStagePage(context, {
      stageId,
      pipelineId: query.get("pipelineId") ?? "",
      q: query.get("q") ?? "",
      responsible: query.get("responsible") ?? "",
      priority: query.get("priority") ?? "ALL",
      stageCode: query.get("stageCode") ?? "ALL",
      phoneType: query.get("phoneType") ?? "ALL",
      offset: query.get("offset") ?? "0",
      limit: query.get("limit") ?? "20",
    });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
