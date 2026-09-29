import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ leadId: string }> }) {
  try {
    const auth = await requireApiAuthentication(request);
    const { leadId } = await context.params;
    const channel = request.nextUrl.searchParams.get("channel") === "EMAIL" ? "EMAIL" : "PHONE";
    return NextResponse.json({ result: await getPrivacyService().getLeadStatus(auth, leadId, channel) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
