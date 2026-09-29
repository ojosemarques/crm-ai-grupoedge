import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAuditAdministrationService } from "@/modules/audit/application/audit-administration-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    return NextResponse.json(await getAuditAdministrationService().getScreen(context, query));
  } catch (error) {
    return handleRouteError(error);
  }
}
