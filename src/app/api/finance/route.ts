import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as T;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const result = await getFinanceService().screen(context, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const result = await getFinanceService().command(context, await request.json().catch(() => null));
    return NextResponse.json({ result: jsonSafe(result) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
