import { NextResponse } from "next/server";
import { uniqueParam } from "@/app/api/oauth/route-helpers";
import { getCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { oauthFailure, oauthHeaders, oauthOptions, rateLimitOAuth, readOAuthForm } from "../route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await rateLimitOAuth(request, "revoke");
    const form = await readOAuthForm(request);
    await getCrmMcpOAuthService().revoke(uniqueParam(form, "token")!, uniqueParam(form, "client_id")!);
    return new NextResponse(null, { status: 200, headers: oauthHeaders });
  } catch (error) { return oauthFailure(error); }
}
export const OPTIONS = oauthOptions;
