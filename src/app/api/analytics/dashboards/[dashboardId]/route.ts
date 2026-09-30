import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = Readonly<{ params: Promise<{ dashboardId: string }> }>;

export async function GET(request: NextRequest, context: Context) {
  try { const { dashboardId } = await context.params; return NextResponse.json({ result: await getAnalyticsBuilderService().readDashboard(await requireApiAuthentication(request), dashboardId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try { assertSameOrigin(request); const { dashboardId } = await context.params; const result = await getAnalyticsBuilderService().update(await requireApiAuthentication(request), dashboardId, await readLimitedJson(request, 128 * 1024)); return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
export async function DELETE(request: NextRequest, context: Context) {
  try { assertSameOrigin(request); const { dashboardId } = await context.params; const revision = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("revision")); const result = await getAnalyticsBuilderService().archive(await requireApiAuthentication(request), dashboardId, revision); return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
