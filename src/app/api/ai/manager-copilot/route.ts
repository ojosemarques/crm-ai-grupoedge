import { NextRequest, NextResponse } from "next/server";

import { getManagerCopilotService } from "@/modules/ai/application/manager-copilot-service";
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

function searchInput(request: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    result[key] = values.length === 1 ? values[0]! : values;
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getManagerCopilotService().getShell(context, searchInput(request));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("manager-copilot", context.memberId, sensitiveEndpointPolicies.artificialIntelligence);
    const body: unknown = await readLimitedJson(request, 256 * 1024);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação do Copilot.", {
        code: "INVALID_INPUT", statusCode: 400, expose: true,
      });
    }
    const data = "data" in body && body.data && typeof body.data === "object" ? body.data : {};
    const service = getManagerCopilotService();
    const result = body.action === "RUN"
      ? await service.run(context, data)
      : body.action === "CONFIRM"
        ? await service.confirm(context, data)
        : (() => {
            throw new ApplicationError("Ação do Copilot desconhecida.", {
              code: "INVALID_INPUT", statusCode: 400, expose: true,
            });
          })();
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
