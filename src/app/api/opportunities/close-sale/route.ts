import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const commandSchema = z.object({ action: z.enum(["PREVIEW", "EXECUTE"]), payload: z.unknown() }).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    await enforceRateLimit("sale-completion", `${context.workspaceId}:${context.memberId}`, sensitiveEndpointPolicies.paymentAction);
    const command = commandSchema.parse(await readLimitedJson(request, 32 * 1024));
    const service = getSaleCompletionService();
    const result = command.action === "PREVIEW" ? await service.preview(context, command.payload) : await service.execute(context, command.payload);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
