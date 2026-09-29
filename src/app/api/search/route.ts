import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getWorkspaceExperienceService } from "@/modules/workspace-experience/application/workspace-experience-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { const context = await requireApiAuthentication(request); await enforceRateLimit("global-search", `${context.workspaceId}:${context.memberId}:${requestClientKey(request)}`, { limit: 90, windowMs: 60_000 }); const result = await getWorkspaceExperienceService().search(context, Object.fromEntries(request.nextUrl.searchParams.entries())); return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); } catch (error) { return handleRouteError(error); } }
