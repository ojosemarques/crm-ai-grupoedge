import { NextRequest, NextResponse } from "next/server";

import { getAccountService } from "@/modules/accounts/application/account-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, routeContext: Readonly<{ params: Promise<{ reviewId: string }> }>) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { reviewId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    return NextResponse.json({ result: await getAccountService().resolveReview(context, reviewId, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
