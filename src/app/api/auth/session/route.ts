import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json(
      {
        session: {
          id: context.sessionId,
          user: {
            id: context.userId,
            displayName: context.displayName,
            role: { key: context.roleKey, name: context.roleName },
          },
          workspace: {
            id: context.workspaceId,
            slug: context.workspaceSlug,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
