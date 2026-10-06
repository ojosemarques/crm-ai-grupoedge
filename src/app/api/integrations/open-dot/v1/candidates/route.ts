import type { NextRequest } from "next/server";

import { signedOpenDotRoute } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { getProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return signedOpenDotRoute(request, "RESEARCH_WRITE", async (transaction, principal, body) => ({
    status: 202,
    body: await getProspectingStagingService().ingestCandidate(transaction, principal, body),
  }));
}
