import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { getN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { assertLocalOnly(request); enforceLocalRateLimit("n8n-machine-events", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const authorization = request.headers.get("authorization") ?? ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""; const query = Object.fromEntries(request.nextUrl.searchParams); return NextResponse.json({ result: await getN8nGovernanceService().listEvents(token, query) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}
