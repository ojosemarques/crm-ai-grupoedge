import { NextRequest, NextResponse } from "next/server";

import { getAccountService } from "@/modules/accounts/application/account-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = await request.json().catch(() => ({})) as { mode?: string };
    const mode = body.mode === "EXECUTE" ? "EXECUTE" : "DRY_RUN";
    return NextResponse.json({ result: await getAccountService().createLegacyCandidates(context, mode) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
