import { NextRequest,NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getFarmerService } from "@/modules/farmer/application/farmer-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function GET(request:NextRequest,ctx:RouteContext<"/api/farmer/[renewalId]">){try{const auth=await requireApiAuthentication(request);const{renewalId}=await ctx.params;return NextResponse.json({result:await getFarmerService().detail(auth,renewalId)},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
export async function PATCH(request:NextRequest,ctx:RouteContext<"/api/farmer/[renewalId]">){try{assertSameOrigin(request);const auth=await requireApiAuthentication(request);const{renewalId}=await ctx.params;return NextResponse.json({result:await getFarmerService().actRenewal(auth,renewalId,await request.json().catch(()=>null))},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
