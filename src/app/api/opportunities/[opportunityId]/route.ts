import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OpportunityRouteContext = Readonly<{
  params: Promise<{ opportunityId: string }>;
}>;

export async function POST(request: NextRequest, routeContext: OpportunityRouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { opportunityId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new ApplicationError("Informe a ação da oportunidade.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const command = { ...body, opportunityId };
    const result = body.action === "TRANSITION"
      ? await getOpportunityService().transition(context, command, { requireIntegratedSale: true })
      : body.action === "PROPOSAL"
        ? await getOpportunityService().registerProposal(context, command)
        : body.action === "REOPEN"
          ? await getOpportunityService().reopen(context, command)
          : (() => {
              throw new ApplicationError("Ação de oportunidade inválida.", {
                code: "INVALID_INPUT",
                statusCode: 400,
                expose: true,
              });
            })();
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
