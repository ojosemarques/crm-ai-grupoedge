import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function GET(request:NextRequest){try{const context=await requireApiAuthentication(request);const query=request.nextUrl.searchParams.get("q");const status=request.nextUrl.searchParams.get("status");return NextResponse.json({result:paymentJsonSafe(await getPaymentService().screen(context,{...(query?{query}:{}),...(status?{status}:{})}))});}catch(error){return handleRouteError(error);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);await enforceRateLimit("payment-action",requestClientKey(request),sensitiveEndpointPolicies.paymentAction);const context=await requireApiAuthentication(request);return NextResponse.json({result:paymentJsonSafe(await getPaymentService().createInvoice(context,await request.json().catch(()=>null)))},{status:201});}catch(error){return handleRouteError(error);}}
