import { NextRequest, NextResponse } from "next/server";
import { revenueSearchInput } from "@/app/api/metrics/revenue/route-helpers";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { const result = await getRevenueMetricsService().getScreen(await requireApiAuthentication(request), revenueSearchInput(request)); return NextResponse.json({ result: { query: result.query, cohorts: result.cohorts } }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
