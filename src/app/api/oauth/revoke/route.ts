import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { oauthErrorResponse, readForm, uniqueParam } from "@/app/api/oauth/route-helpers";
import { getPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const form = await readForm(request);
    await getPolitizaiMcpOAuthService().revokeRefreshToken(uniqueParam(form, "token")!, uniqueParam(form, "client_id")!);
    return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
