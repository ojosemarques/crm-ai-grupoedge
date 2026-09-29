import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { getN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
const paramsSchema = z.object({ type: z.enum(["lead", "meeting", "opportunity", "account"]), id: z.string().uuid() }).strict();
export async function GET(request: NextRequest, context: RouteContext<"/api/local/n8n/v1/records/[type]/[id]">) {
  try { assertLocalOnly(request); enforceLocalRateLimit("n8n-machine-record", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const params = paramsSchema.parse(await context.params); const authorization = request.headers.get("authorization") ?? ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""; return NextResponse.json({ result: await getN8nGovernanceService().getRecord(token, params.type, params.id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}
