import type { NextRequest } from "next/server";

import { signedOpenDotRoute } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { getProspectingEmailService } from "@/modules/prospecting/application/prospecting-email-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return signedOpenDotRoute(request, "EMAIL_EVENT_WRITE", async (transaction, principal, body) => ({
    status: 202,
    body: await getProspectingEmailService().event(transaction, principal, body),
  }));
}
