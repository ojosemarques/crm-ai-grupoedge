import { NextRequest, NextResponse } from "next/server";

import { getAccountService } from "@/modules/accounts/application/account-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getAccountService().listReviews(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
