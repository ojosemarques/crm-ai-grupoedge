import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { paymentJsonSafe } from "@/modules/payments/http/payment-http";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function GET(request:NextRequest,{params}:{params:Promise<{invoiceId:string}>}){try{const context=await requireApiAuthentication(request);return NextResponse.json({result:paymentJsonSafe(await getPaymentService().detail(context,(await params).invoiceId))});}catch(error){return handleRouteError(error);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{invoiceId:string}>}){try{assertSameOrigin(request);await enforceRateLimit("payment-action",requestClientKey(request),sensitiveEndpointPolicies.paymentAction);const context=await requireApiAuthentication(request);return NextResponse.json({result:paymentJsonSafe(await getPaymentService().act(context,(await params).invoiceId,await request.json().catch(()=>null)))});}catch(error){return handleRouteError(error);}}
