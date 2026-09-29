import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  try {
    const auth = await requireApiAuthentication(request);
    const { requestId } = await context.params;
    return NextResponse.json({ result: await getPrivacyService().exportDsr(auth, requestId) }, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="dsr-${requestId}.json"` } });
  } catch (error) {
    return handleRouteError(error);
  }
}
