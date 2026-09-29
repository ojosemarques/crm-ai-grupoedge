import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOperationsService, operationsCorrelationId } from "@/modules/operations/application/operations-service";
import { alertActionSchema, operationsListQuerySchema, TELEMETRY_CONTRACT_VERSION } from "@/modules/operations/domain/operations-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
import { logger } from "@/shared/core/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const query = operationsListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ result: await getOperationsService().getScreen(context, query) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("operations", `${context.workspaceId}:${context.actorId}:${requestClientKey(request)}`, sensitiveEndpointPolicies.operations);
    const body = alertActionSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getOperationsService();
    const correlationId = body.action === "EVALUATE_ALERTS" ? body.data.correlationId : operationsCorrelationId("operations-api");
    const result = body.action === "EVALUATE_ALERTS" ? await service.evaluateAlerts(context, body.data.correlationId)
      : body.action === "ACKNOWLEDGE_ALERT" ? await service.alertAction(context, { ...body.data, status: "ACKNOWLEDGED" })
      : body.action === "RESOLVE_ALERT" ? await service.alertAction(context, { ...body.data, status: "RESOLVED" })
      : body.action === "CREATE_INCIDENT" ? await service.createIncident(context, body.data)
      : body.action === "TRANSITION_INCIDENT" ? await service.transitionIncident(context, body.data)
      : body.action === "CREATE_DSR" ? await service.createDsr(context, body.data)
      : body.action === "PREVIEW_DESTRUCTION" ? await service.previewDestruction(context, body.data)
      : await service.runRetentionCheckpoint(context, body.data);
    try {
      await service.recordTelemetry(context, { contractVersion: TELEMETRY_CONTRACT_VERSION, kind: "TRACE", operation: `api.operations.${body.action.toLowerCase()}`, outcome: "SUCCESS", durationMs: Date.now() - startedAt, correlationId, requestId: correlationId, labels: { route: "/api/operations", method: "POST", status_class: "2xx", operation: body.action.toLowerCase() }, metadata: { action: body.action, externalEgress: false }, occurredAt: new Date() });
    } catch (telemetryError) {
      logger.warn({ correlationId, errorName: telemetryError instanceof Error ? telemetryError.name : "UnknownError" }, "A ação foi concluída, mas a telemetria local não pôde ser persistida");
    }
    return NextResponse.json({ result, correlationId }, { headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
