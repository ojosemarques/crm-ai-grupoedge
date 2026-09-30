import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getStage09ReadinessService } from "@/modules/integrations/application/stage09-readiness-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getStage09ReadinessService().screen(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
