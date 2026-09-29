import { NextRequest,NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function GET(request:NextRequest){try{const context=await requireApiAuthentication(request);const to=new Date(request.nextUrl.searchParams.get("to")??Date.now());const from=new Date(request.nextUrl.searchParams.get("from")??new Date(to.getTime()-30*86400000));return NextResponse.json({result:await getRevenueService().summary(context,from,to)});}catch(e){return handleRouteError(e)}}
