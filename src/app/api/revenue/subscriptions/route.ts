import { NextRequest,NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function GET(request:NextRequest){try{const c=await requireApiAuthentication(request);return NextResponse.json({result:await getRevenueService().list(c,new Date(request.nextUrl.searchParams.get("cutoff")??Date.now()))});}catch(e){return handleRouteError(e);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);const c=await requireApiAuthentication(request);return NextResponse.json({result:await getRevenueService().create(c,await request.json().catch(()=>null))},{status:201});}catch(e){return handleRouteError(e);}}
