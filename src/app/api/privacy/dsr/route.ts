import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) throw new ApplicationError("Informe a ação da solicitação.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    const data = "data" in body ? body.data : null;
    const service = getPrivacyService();
    const result = body.action === "CREATE"
      ? await service.createDsr(context, data)
      : body.action === "TRANSITION"
        ? await service.transitionDsr(context, data)
        : (() => { throw new ApplicationError("Ação de solicitação desconhecida.", { code: "INVALID_INPUT", statusCode: 400, expose: true }); })();
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
