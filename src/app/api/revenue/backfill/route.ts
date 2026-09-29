import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getRevenueBackfillService } from "@/modules/revenue/application/revenue-backfill-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic";export const runtime="nodejs";
const schema=z.object({mode:z.enum(["DRY_RUN","EXECUTE"]),idempotencyKey:z.string().min(8)});
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);return NextResponse.json({result:await getRevenueBackfillService().run(context,schema.parse(await request.json().catch(()=>null)))})}catch(e){return handleRouteError(e)}}
