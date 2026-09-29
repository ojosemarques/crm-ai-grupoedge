import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getGoalService } from "@/modules/goals/application/goal-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getGoalService().screen(context, Object.fromEntries(request.nextUrl.searchParams.entries())) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const result = await getGoalService().createDraft(context, await readLimitedJson(request, 128 * 1024));
    return NextResponse.json({ result: jsonSafe(result) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
