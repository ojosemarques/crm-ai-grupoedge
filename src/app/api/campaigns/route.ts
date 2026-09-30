import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getOutboundCampaignService } from "@/modules/campaigns/application/outbound-campaign-service";
import { campaignCommandSchema } from "@/modules/campaigns/domain/outbound-campaign-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const campaignId = request.nextUrl.searchParams.get("campaignId") ?? undefined;
    return NextResponse.json({ result: await getOutboundCampaignService().screen(context, campaignId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const input = campaignCommandSchema.parse(await readLimitedJson(request, 512 * 1024));
    return NextResponse.json({ result: await getOutboundCampaignService().command(context, input) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
