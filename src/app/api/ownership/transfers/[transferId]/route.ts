import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ transferId: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { transferId } = await params;
    const body: unknown = await request.json().catch(() => null);
    return NextResponse.json({ result: await getLifecycleService().respondTransfer(context, transferId, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
