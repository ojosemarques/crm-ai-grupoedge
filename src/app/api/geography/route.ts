import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getGeographicIntelligenceService } from "@/modules/geography/application/geographic-intelligence-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("BACKFILL"),data:z.unknown()}).strict(),
  z.object({action:z.literal("PREVIEW_TERRITORY"),data:z.unknown()}).strict(),
  z.object({action:z.literal("PUBLISH_TERRITORY"),data:z.unknown()}).strict(),
  z.object({action:z.literal("RECORD_OBSERVATION"),data:z.unknown()}).strict(),
  z.object({action:z.literal("RESOLVE_TERRITORY"),data:z.unknown()}).strict(),
  z.object({action:z.literal("SET_TERRITORY_STATUS"),data:z.unknown()}).strict(),
]);

function query(request:NextRequest){
  const input:Record<string,string|string[]>={};
  for(const key of request.nextUrl.searchParams.keys()){
    const values=request.nextUrl.searchParams.getAll(key);input[key]=values.length>1?values:values[0]!;
  }
  for(const key of ["sourceIds","campaignIds","creativeIds","sdrMemberIds","closerMemberIds","teamIds","stageIds","priorityCodes","precisions","evidenceClasses","verificationStatuses"]){const value=input[key];if(typeof value==="string")input[key]=value?value.split(","):[];else if(!value)input[key]=[];}
  return input;
}

export async function GET(request:NextRequest){try{const context=await requireApiAuthentication(request);const result=await getGeographicIntelligenceService().getScreen(context,query(request));return NextResponse.json({result},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);const body=actionSchema.parse(await readLimitedJson(request,256*1024));const service=getGeographicIntelligenceService();const result=body.action==="BACKFILL"?await service.runBackfill(context,body.data):body.action==="PREVIEW_TERRITORY"?await service.previewTerritory(context,body.data):body.action==="PUBLISH_TERRITORY"?await service.publishTerritory(context,body.data):body.action==="RECORD_OBSERVATION"?await service.recordObservation(context,body.data):body.action==="RESOLVE_TERRITORY"?await service.resolveTerritory(context,body.data):await service.setTerritoryStatus(context,body.data);return NextResponse.json({result},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
