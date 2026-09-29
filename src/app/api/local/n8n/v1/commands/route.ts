import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { getN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { N8N_MAX_BODY_BYTES } from "@/modules/integrations/domain/n8n-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertLocalOnly(request); enforceLocalRateLimit("n8n-machine-command", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const rawBody = (await readLimitedBuffer(request, N8N_MAX_BODY_BYTES)).toString("utf8");
    const result = await getN8nGovernanceService().receiveCommand(rawBody, { authorization: request.headers.get("authorization"), timestamp: request.headers.get("x-politizai-timestamp"), nonce: request.headers.get("x-politizai-nonce"), signature: request.headers.get("x-politizai-signature"), idempotencyKey: request.headers.get("idempotency-key"), correlationId: request.headers.get("x-correlation-id"), causationId: request.headers.get("x-causation-id") ?? undefined, causationDepth: request.headers.get("x-causation-depth") ?? "0" });
    return NextResponse.json({ result }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
