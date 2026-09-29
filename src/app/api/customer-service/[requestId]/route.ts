import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCustomerServiceService } from "@/modules/customer-service/application/customer-service-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(request: NextRequest, context: RouteContext<"/api/customer-service/[requestId]">) { try { const auth = await requireApiAuthentication(request); const { requestId } = await context.params; return NextResponse.json({ result: await getCustomerServiceService().detail(auth, requestId) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: NextRequest, context: RouteContext<"/api/customer-service/[requestId]">) { try { assertSameOrigin(request); const auth = await requireApiAuthentication(request); const { requestId } = await context.params; const body = z.object({ action: z.enum(["ASSIGN", "ACT"]), payload: z.unknown() }).parse(await request.json().catch(() => null)); const service = getCustomerServiceService(); return NextResponse.json({ result: body.action === "ASSIGN" ? await service.assign(auth, requestId, body.payload) : await service.act(auth, requestId, body.payload) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
