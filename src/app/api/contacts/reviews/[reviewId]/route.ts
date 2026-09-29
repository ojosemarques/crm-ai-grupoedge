import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getContactIdentityService } from "@/modules/contacts/application/contact-identity-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  routeContext: Readonly<{ params: Promise<{ reviewId: string }> }>,
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { reviewId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => ({}));
    const data = body && typeof body === "object" ? body : {};
    const result = await getContactIdentityService().resolveReview(context, { ...data, reviewId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
