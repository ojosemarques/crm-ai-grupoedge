import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getIntegrationPlatformService } from "@/modules/integrations/application/integration-platform-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  try { const auth = await requireApiAuthentication(request); const { connectionId } = await context.params; return NextResponse.json({ result: await getIntegrationPlatformService().detail(auth, connectionId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}
