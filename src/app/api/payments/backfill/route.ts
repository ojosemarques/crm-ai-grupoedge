import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPaymentBackfillService } from "@/modules/payments/application/payment-backfill-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);return NextResponse.json({result:paymentJsonSafe(await getPaymentBackfillService().run(context,await request.json().catch(()=>null)))});}catch(error){return handleRouteError(error);}}
