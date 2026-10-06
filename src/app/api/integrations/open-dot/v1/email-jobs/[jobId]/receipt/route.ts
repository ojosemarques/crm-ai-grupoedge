import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedOpenDotRoute } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { getProspectingEmailService } from "@/modules/prospecting/application/prospecting-email-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const params = await context.params;
  return signedOpenDotRoute(request, "EMAIL_RECEIPT", async (transaction, principal, body) => ({
    body: await getProspectingEmailService().receipt(
      transaction,
      principal,
      z.object({ jobId: z.string().uuid() }).parse(params).jobId,
      body,
    ),
  }));
}
