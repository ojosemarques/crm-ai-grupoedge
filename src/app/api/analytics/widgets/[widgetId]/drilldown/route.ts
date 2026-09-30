import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = Readonly<{ params: Promise<{ widgetId: string }> }>;
export async function GET(request: NextRequest, context: Context) {
  try { const { widgetId } = await context.params; return NextResponse.json({ result: await getAnalyticsBuilderService().orderedDataset(await requireApiAuthentication(request), widgetId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, request); }
}
