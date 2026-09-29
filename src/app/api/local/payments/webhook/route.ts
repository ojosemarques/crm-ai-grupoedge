import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { PAYMENT_MAX_WEBHOOK_BYTES } from "@/modules/payments/domain/payment-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceLocalRateLimit, readLimitedBuffer, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function POST(request:NextRequest){try{assertLocalOnly(request);enforceLocalRateLimit("payment-webhook",requestClientKey(request),sensitiveEndpointPolicies.paymentWebhook);const workspaceId=z.string().uuid().parse(request.headers.get("x-politizai-workspace-id"));const body=await readLimitedBuffer(request,PAYMENT_MAX_WEBHOOK_BYTES);const result=await getPaymentService().ingestSignedLocalWebhook(workspaceId,body,request.headers.get("x-politizai-payment-timestamp"),request.headers.get("x-politizai-payment-signature"));return NextResponse.json({result},{status:202,headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
