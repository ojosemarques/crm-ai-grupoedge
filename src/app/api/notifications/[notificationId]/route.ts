import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getNotificationService } from "@/modules/automations/application/notification-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = Readonly<{ params: Promise<{ notificationId: string }> }>;

export async function PATCH(request: NextRequest, routeContext: Context) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { notificationId } = await routeContext.params;
    const result = await getNotificationService().markRead(context, { notificationId });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
