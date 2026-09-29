import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getContractService } from "@/modules/contracts/application/contract-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ contractId: string }> }>) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { contractId } = await params;
    const result = await getContractService().act(context, contractId, await request.json().catch(() => null));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
