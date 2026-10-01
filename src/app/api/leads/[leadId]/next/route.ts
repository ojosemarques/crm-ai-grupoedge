import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getSdrQueueService } from "@/modules/leads/application/sdr-queue-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NextLeadRouteContext = Readonly<{
  params: Promise<{ leadId: string }>;
}>;

export async function GET(
  request: NextRequest,
  routeContext: NextLeadRouteContext,
) {
  try {
    const context = await requireApiAuthentication(request);
    const { leadId } = await routeContext.params;
    const screen = await getSdrQueueService().getScreen(context, {});
    const next = screen.sections
      .find((section) => section.key === "NOW")
      ?.items.find((item) => item.id !== leadId);

    return NextResponse.json(
      {
        result: next
          ? {
              id: next.id,
              fullName: next.fullName,
              href: `/leads/${next.id}/historico${next.recommendation.href.includes("#") ? `#${next.recommendation.href.split("#")[1]}` : ""}`,
            }
          : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
