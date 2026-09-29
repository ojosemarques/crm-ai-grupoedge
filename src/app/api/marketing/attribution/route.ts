import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { attributionModelVersionInputSchema, attributionRunInputSchema, landingPageDefinitionSchema, marketingBackfillInputSchema, marketingFormDefinitionSchema } from "@/modules/marketing/domain/marketing-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RUN"), data: attributionRunInputSchema }).strict(),
  z.object({ action: z.literal("BACKFILL"), data: marketingBackfillInputSchema }).strict(),
  z.object({ action: z.literal("RESOLVE_ISSUE"), issueId: z.string().uuid(), reason: z.string().trim().min(3).max(1_000) }).strict(),
  z.object({ action: z.literal("SAVE_LANDING_PAGE"), data: landingPageDefinitionSchema }).strict(),
  z.object({ action: z.literal("SAVE_MARKETING_FORM"), data: marketingFormDefinitionSchema }).strict(),
  z.object({ action: z.literal("VERSION_MODEL"), data: attributionModelVersionInputSchema }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    return NextResponse.json({ result: await getMarketingAttributionService().getScreen(context, params) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = bodySchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getMarketingAttributionService();
    const result = body.action === "RUN" ? await service.runAttribution(context, body.data)
      : body.action === "BACKFILL" ? await service.backfill(context, body.data)
        : body.action === "RESOLVE_ISSUE" ? await service.resolveIssue(context, body.issueId, body.reason)
          : body.action === "SAVE_LANDING_PAGE" ? await service.saveLandingPage(context, body.data)
            : body.action === "SAVE_MARKETING_FORM" ? await service.saveMarketingForm(context, body.data)
              : await service.createModelVersion(context, body.data);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
