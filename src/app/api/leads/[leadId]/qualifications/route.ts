import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getFreeQualificationService } from "@/modules/qualification/application/free-qualification-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QualificationsRouteContext = Readonly<{
  params: Promise<{ leadId: string }>;
}>;

export async function GET(request: NextRequest, routeContext: QualificationsRouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const result = await getFreeQualificationService().getScreen(context, { leadId });
    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, routeContext: QualificationsRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    const data = body && typeof body === "object" ? body : {};
    const result = await getFreeQualificationService().create(context, { ...data, leadId });
    return NextResponse.json(
      { result },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
