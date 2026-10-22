import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOteService } from "@/modules/ote/application/ote-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getOteService().screen(context, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleRouteError(error, request); }
}
