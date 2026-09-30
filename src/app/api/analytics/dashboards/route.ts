import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try { assertSameOrigin(request); const result = await getAnalyticsBuilderService().create(await requireApiAuthentication(request), await readLimitedJson(request, 128 * 1024)); return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
