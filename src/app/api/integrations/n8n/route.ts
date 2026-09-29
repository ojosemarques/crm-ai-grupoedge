import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { createN8nMachineSchema, createN8nRecipeSchema, reviewN8nProposalSchema, rotateN8nMachineSchema, setN8nMachineScopesSchema, setN8nMachineStatusSchema, setN8nRecipeStatusSchema } from "@/modules/integrations/domain/n8n-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_MACHINE"), data: createN8nMachineSchema }).strict(),
  z.object({ action: z.literal("ROTATE_MACHINE"), data: rotateN8nMachineSchema }).strict(),
  z.object({ action: z.literal("SET_MACHINE_STATUS"), data: setN8nMachineStatusSchema }).strict(),
  z.object({ action: z.literal("SET_MACHINE_SCOPES"), data: setN8nMachineScopesSchema }).strict(),
  z.object({ action: z.literal("CREATE_RECIPE"), data: createN8nRecipeSchema }).strict(),
  z.object({ action: z.literal("SET_RECIPE_STATUS"), data: setN8nRecipeStatusSchema }).strict(),
  z.object({ action: z.literal("REVIEW_PROPOSAL"), data: reviewN8nProposalSchema }).strict(),
]);

export async function GET(request: NextRequest) {
  try { const context = await requireApiAuthentication(request); return NextResponse.json({ result: await getN8nGovernanceService().list(context) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); await enforceRateLimit("n8n-administration", requestClientKey(request), sensitiveEndpointPolicies.n8nAdministration);
    const context = await requireApiAuthentication(request); const command = commandSchema.parse(await readLimitedJson(request, 64 * 1024)); const service = getN8nGovernanceService();
    const result = command.action === "CREATE_MACHINE" ? await service.createMachine(context, command.data)
      : command.action === "ROTATE_MACHINE" ? await service.rotateMachine(context, command.data)
      : command.action === "SET_MACHINE_STATUS" ? await service.setMachineStatus(context, command.data)
      : command.action === "SET_MACHINE_SCOPES" ? await service.setMachineScopes(context, command.data)
      : command.action === "CREATE_RECIPE" ? await service.createRecipe(context, command.data)
      : command.action === "SET_RECIPE_STATUS" ? await service.setRecipeStatus(context, command.data)
      : await service.reviewProposal(context, command.data);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
