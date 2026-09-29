import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: Readonly<{ params: Promise<{ caseId: string }> }>,
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const result = await getOnboardingService().actOnboarding(
      context,
      (await params).caseId,
      await request.json().catch(() => null),
    );
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
