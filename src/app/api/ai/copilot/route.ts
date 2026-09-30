import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCopilotService } from "@/modules/ai-assistant/application/copilot-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Up to two bounded read-only searches followed by the final model response.
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getCopilotService().screen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("ai-copilot", context.memberId, sensitiveEndpointPolicies.artificialIntelligence);
    const command = await readLimitedJson(request, 96 * 1024);
    return NextResponse.json({ result: await getCopilotService().command(context, command) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
