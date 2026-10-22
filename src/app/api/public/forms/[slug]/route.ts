import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: RouteContext<"/api/public/forms/[slug]">) {
  try {
    const { slug } = await params;
    return NextResponse.json({ result: await getMarketingFormService().resolvePublic(slug) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
