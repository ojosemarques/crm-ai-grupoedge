import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getGoogleAdsService } from "@/modules/integrations/application/google-ads-service";
import { googleAdsCommandSchema } from "@/modules/integrations/domain/google-ads-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getGoogleAdsService().screen(context);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const command = googleAdsCommandSchema.parse(await readLimitedJson(request, 64 * 1024));
    const service = getGoogleAdsService();
    const result = command.action === "CONFIGURE"
      ? await service.configure(context, command.data)
      : command.action === "TEST_CONNECTION"
        ? await service.testConnection(context)
        : command.action === "RUN_SYNC"
          ? await service.runSync(context, { mode: command.mode, correlationId: command.correlationId })
          : command.action === "PREVIEW_BACKFILL"
            ? await service.previewBackfill(context, command.since, command.until)
            : command.action === "RUN_BACKFILL"
              ? await service.runBackfill(context, { since: command.since, until: command.until, correlationId: command.correlationId })
              : await service.setPaused(context, command.revision, command.action === "PAUSE");
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
