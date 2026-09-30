import type { NextRequest } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = Readonly<{ params: Promise<{ widgetId: string }> }>;
export async function GET(request: NextRequest, context: Context) {
  try { const { widgetId } = await context.params; const result = await getAnalyticsBuilderService().csv(await requireApiAuthentication(request), widgetId); return new Response(result.csv, { headers: { "Cache-Control": "no-store", "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "X-Record-Count": String(result.total), "X-Result-Truncated": String(result.truncated) } }); }
  catch (error) { return handleRouteError(error, request); }
}
