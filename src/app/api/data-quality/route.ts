import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getDataQualityService } from "@/modules/data-quality/application/data-quality-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SCAN"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("ISSUE"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("DECIDE_CANDIDATE"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("PREVIEW_MERGE"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("CREATE_MERGE_PLAN"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("APPLY_MERGE"), data: z.unknown() }).strict(),
  z.object({ action: z.literal("ROLLBACK_MERGE"), data: z.unknown() }).strict(),
]);

function query(request: NextRequest) {
  const value: Record<string, string> = {};
  for (const [key, item] of request.nextUrl.searchParams.entries()) value[key] = item;
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getDataQualityService().getScreen(context, query(request));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = actionSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getDataQualityService();
    const result = body.action === "SCAN" ? await service.runScan(context, body.data)
      : body.action === "ISSUE" ? await service.issueAction(context, body.data)
      : body.action === "DECIDE_CANDIDATE" ? await service.decideCandidate(context, body.data)
      : body.action === "PREVIEW_MERGE" ? await service.buildPreview(context, body.data)
      : body.action === "CREATE_MERGE_PLAN" ? await service.createMergePlan(context, body.data)
      : body.action === "APPLY_MERGE" ? await service.applyMerge(context, body.data)
      : await service.rollbackMerge(context, body.data);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
