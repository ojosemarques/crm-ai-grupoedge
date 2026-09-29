import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getLifecycleService().listPendingTransfers(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = await request.json().catch(() => null) as { action?: string; payload?: unknown } | null;
    const service = getLifecycleService();
    const result = body?.action === "assign" ? await service.assignOwnership(context, body.payload) : body?.action === "request-transfer" ? await service.requestTransfer(context, body.payload) : null;
    if (!result) return NextResponse.json({ error: { code: "INVALID_ACTION", message: "Ação de ownership inválida." } }, { status: 400 });
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
