import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getConsumptionGovernanceService } from "@/modules/consumption/application/consumption-governance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIGURE"), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("GRANT_CREDIT"), payload: z.unknown() }).strict(),
  z.object({ action: z.literal("SET_STATUS"), budgetId: z.string().uuid(), status: z.enum(["ACTIVE", "PAUSED", "REVOKED"]), reason: z.string().trim().min(3).max(500) }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getConsumptionGovernanceService().getOverview(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const command = commandSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getConsumptionGovernanceService();
    const result = command.action === "CONFIGURE"
      ? await service.configure(context, command.payload)
      : command.action === "GRANT_CREDIT"
        ? await service.grantCredit(context, command.payload)
        : await service.setStatus(context, command.budgetId, command.status, command.reason);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
