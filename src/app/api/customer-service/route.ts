import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCustomerServiceService } from "@/modules/customer-service/application/customer-service-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { const context = await requireApiAuthentication(request); return NextResponse.json({ result: await getCustomerServiceService().screen(context, Object.fromEntries(request.nextUrl.searchParams.entries())) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const context = await requireApiAuthentication(request); const body = z.object({ action: z.enum(["OPEN", "PUBLISH_SLA", "PUBLISH_SURVEY", "INVITE_SURVEY", "RESPOND_SURVEY"]), payload: z.unknown() }).parse(await request.json().catch(() => null)); const service = getCustomerServiceService(); const result = body.action === "OPEN" ? await service.open(context, body.payload) : body.action === "PUBLISH_SLA" ? await service.publishSlaVersion(context, body.payload) : body.action === "PUBLISH_SURVEY" ? await service.publishSurveyVersion(context, body.payload) : body.action === "INVITE_SURVEY" ? await service.invite(context, body.payload) : await service.respondSurvey(context, body.payload); return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
