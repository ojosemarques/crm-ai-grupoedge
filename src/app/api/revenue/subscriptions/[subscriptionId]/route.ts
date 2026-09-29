import { NextRequest,NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function GET(request:NextRequest,{params}:{params:Promise<{subscriptionId:string}>}){try{const c=await requireApiAuthentication(request);return NextResponse.json({result:await getRevenueService().detail(c,(await params).subscriptionId)});}catch(e){return handleRouteError(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{subscriptionId:string}>}){try{assertSameOrigin(request);const c=await requireApiAuthentication(request);return NextResponse.json({result:await getRevenueService().action(c,(await params).subscriptionId,await request.json().catch(()=>null))});}catch(e){return handleRouteError(e);}}
