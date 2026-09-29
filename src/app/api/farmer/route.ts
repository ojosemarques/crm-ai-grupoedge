import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getFarmerService } from "@/modules/farmer/application/farmer-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function GET(request:NextRequest){try{const context=await requireApiAuthentication(request);return NextResponse.json({result:await getFarmerService().screen(context,Object.fromEntries(request.nextUrl.searchParams.entries()))},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);const body=z.object({action:z.enum(["CREATE_RENEWAL","CREATE_SIGNAL","REVIEW_SIGNAL","REVENUE_DECISION","CORRECT_DECISION"]),payload:z.unknown()}).parse(await request.json().catch(()=>null));const service=getFarmerService();const result=body.action==="CREATE_RENEWAL"?await service.createRenewal(context,body.payload):body.action==="CREATE_SIGNAL"?await service.createSignal(context,body.payload):body.action==="REVIEW_SIGNAL"?await service.reviewSignal(context,body.payload):body.action==="REVENUE_DECISION"?await service.confirmRevenueDecision(context,body.payload):await service.correctDecision(context,body.payload);return NextResponse.json({result},{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
