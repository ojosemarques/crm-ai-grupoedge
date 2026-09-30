import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPageTrackingService } from "@/modules/marketing/application/page-tracking-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedBuffer, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const paramsSchema = z.object({ workspaceSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), connectionKey: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/) });

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string; connectionKey: string }> }) {
  try {
    const params = paramsSchema.parse(await context.params);
    await enforceRateLimit("page-tracking", `${params.workspaceSlug}:${params.connectionKey}:${requestClientKey(request)}`, { limit: 240, windowMs: 60_000 });
    const rawBody = (await readLimitedBuffer(request, 32 * 1024)).toString("utf8");
    const result = await getPageTrackingService().receive({ ...params, rawBody, timestamp: request.headers.get("x-politizai-timestamp") ?? "", signature: request.headers.get("x-politizai-signature") ?? "" });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
