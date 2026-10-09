import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { getLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OperationsRouteContext = Readonly<{
  params: Promise<{ leadId: string }>;
}>;

export async function GET(
  request: NextRequest,
  routeContext: OperationsRouteContext,
) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 20);
    const result = await getOperationalHistoryService().getLeadOperations(
      context,
      {
        leadId,
        ...(cursor ? { cursor } : {}),
        pageSize,
      },
    );
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  routeContext: OperationsRouteContext,
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação operacional.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const action = body.action;
    const data = "data" in body && body.data && typeof body.data === "object"
      ? body.data
      : {};
    const service = getOperationalHistoryService();
    let result: unknown;

    switch (action) {
      case "CREATE_TASK":
        result = "kind" in data && data.kind === "MEETING" && !("meetingId" in data && data.meetingId)
          ? await getMeetingService().schedule(context, {
              leadId,
              closerId: "closerId" in data ? data.closerId : undefined,
              title: "title" in data ? data.title : undefined,
              startsAtLocal: "startsAtLocal" in data ? data.startsAtLocal : undefined,
              durationMinutes: "durationMinutes" in data ? data.durationMinutes : undefined,
              observation: "description" in data ? data.description : undefined,
              taskPriority: "priority" in data ? data.priority : undefined,
            })
          : await service.createTask(context, { ...data, leadId });
        break;
      case "COMPLETE_TASK":
        result = await service.completeTask(context, { ...data, leadId });
        break;
      case "RECORD_ACTIVITY":
        result = await service.recordActivity(context, { ...data, leadId });
        break;
      case "CORRECT_ACTIVITY":
        result = await service.correctActivity(context, { ...data, leadId });
        break;
      case "UPDATE_SUMMARY":
        result = await service.updateLeadSummary(context, { ...data, leadId });
        break;
      case "REDISTRIBUTE":
        result = await getLeadDistributionService().redistribute(context, {
          ...data,
          leadId,
        });
        break;
      default:
        throw new ApplicationError("Ação operacional desconhecida.", {
          code: "INVALID_INPUT",
          statusCode: 400,
          expose: true,
        });
    }

    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
