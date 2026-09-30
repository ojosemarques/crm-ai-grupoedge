import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getConversionFeedbackService } from "@/modules/conversion-feedback/application/conversion-feedback-service";
import { metaConversionCommandSchema } from "@/modules/conversion-feedback/domain/conversion-feedback-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getConversionFeedbackService().getReconciliation(context, Object.fromEntries(request.nextUrl.searchParams.entries())) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("meta-conversion-command", requestClientKey(request), sensitiveEndpointPolicies.n8nAdministration);
    const context = await requireApiAuthentication(request);
    const command = metaConversionCommandSchema.parse(await readLimitedJson(request, 32 * 1024));
    const service = getConversionFeedbackService();
    const result = command.action === "VALIDATE_WRITE_CAPABILITY"
      ? await service.validateMetaWriteCapability(context)
      : command.action === "QUEUE"
      ? await service.queueMetaConversion(context, command)
      : await service.cancelPending(context, command.conversionId, command.reason);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
