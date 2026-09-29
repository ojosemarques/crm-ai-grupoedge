import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getContactBackfillService } from "@/modules/contacts/application/contact-backfill-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const runId = request.nextUrl.searchParams.get("runId");
    if (!runId) {
      throw new ApplicationError("Informe a execução de backfill.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    const result = await getContactBackfillService().getRun(context, { runId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação do backfill.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    const data = "data" in body && body.data && typeof body.data === "object" ? body.data : {};
    const service = getContactBackfillService();
    let result: unknown;
    switch (body.action) {
      case "START": result = await service.start(context, data); break;
      case "PROCESS_BATCH": result = await service.processBatch(context, data); break;
      case "PAUSE": result = await service.pause(context, data); break;
      case "RESUME": result = await service.resume(context, data); break;
      default:
        throw new ApplicationError("Ação de backfill desconhecida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
