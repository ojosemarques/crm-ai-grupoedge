import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedOpenDotRoute } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { getProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  return signedOpenDotRoute(request, "RESEARCH_READ", async (transaction, principal) => ({
    body: await getProspectingStagingService().getResearchBatch(
      transaction,
      principal,
      z.object({ batchId: z.string().uuid() }).parse(params).batchId,
    ),
  }));
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  return signedOpenDotRoute(request, "RESEARCH_WRITE", async (transaction, principal, body) => ({
    body: await getProspectingStagingService().completeResearchBatch(
      transaction,
      principal,
      z.object({ batchId: z.string().uuid() }).parse(params).batchId,
      body,
    ),
  }));
}
