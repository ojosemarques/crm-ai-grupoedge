import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getGoalService } from "@/modules/goals/application/goal-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z.object({ action: z.enum(["UPDATE", "PUBLISH", "CREATE_VERSION", "RETIRE"]), payload: z.unknown() }).strict();

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { planId } = await params;
    const body = bodySchema.parse(await readLimitedJson(request, 128 * 1024));
    const result = body.action === "UPDATE" ? await getGoalService().updateDraft(context, planId, body.payload) : await getGoalService().act(context, planId, { ...(body.payload as object), action: body.action });
    return NextResponse.json({ result: jsonSafe(result) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
