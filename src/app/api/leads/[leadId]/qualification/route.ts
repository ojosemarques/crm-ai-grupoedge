import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QualificationRouteContext = Readonly<{
  params: Promise<{ leadId: string }>;
}>;

export async function GET(
  request: NextRequest,
  routeContext: QualificationRouteContext,
) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getPactoQualificationService().getPacto(context, {
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

export async function POST(
  request: NextRequest,
  routeContext: QualificationRouteContext,
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação de qualificação.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const data = "data" in body && body.data && typeof body.data === "object"
      ? body.data
      : {};
    const payload = { ...data, leadId };
    const service = getPactoQualificationService();
    let result: unknown;
    switch (body.action) {
      case "SAVE_DRAFT":
        result = await service.saveDraft(context, payload);
        break;
      case "VALIDATE":
        result = await service.validate(context, payload);
        break;
      default:
        throw new ApplicationError("Ação de qualificação desconhecida.", {
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
