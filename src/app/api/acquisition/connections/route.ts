import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAcquisitionConnectionService } from "@/modules/acquisition-api/application/acquisition-connection-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const context = await requireApiAuthentication(request); return NextResponse.json({ result: await getAcquisitionConnectionService().configure(context, await readLimitedJson(request, 64 * 1024)) }, { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: NextRequest) { try { assertSameOrigin(request); const context = await requireApiAuthentication(request); return NextResponse.json({ result: await getAcquisitionConnectionService().command(context, await readLimitedJson(request, 64 * 1024)) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleRouteError(error); } }
