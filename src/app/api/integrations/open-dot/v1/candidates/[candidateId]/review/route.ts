import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedOpenDotRoute } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { getProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  const params = await context.params;
  return signedOpenDotRoute(request, "RESEARCH_REVIEW", async (transaction, principal, body) => ({
    body: await getProspectingStagingService().reviewCandidate(
      transaction,
      principal,
      z.object({ candidateId: z.string().uuid() }).parse(params).candidateId,
      body,
    ),
  }));
}
