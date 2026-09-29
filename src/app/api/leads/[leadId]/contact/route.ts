import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getContactIdentityService } from "@/modules/contacts/application/contact-identity-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  routeContext: Readonly<{ params: Promise<{ leadId: string }> }>,
) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getContactIdentityService().getLeadContact(context, { leadId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
