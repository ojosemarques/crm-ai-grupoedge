import { NextRequest, NextResponse } from "next/server";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getPaymentWorkerService } from "@/modules/payments/application/payment-worker-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
export const dynamic="force-dynamic"; export const runtime="nodejs";
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);await getAuthorizationService().assertAuthorized(context,PermissionKeys.PAYMENTS_REPROCESS,{workspaceId:context.workspaceId,resourceType:"Payment",resourceId:context.workspaceId,memberId:context.memberId,ownerMemberId:context.memberId});return NextResponse.json({result:await getPaymentWorkerService().processNext(`manual:${context.memberId}`)});}catch(error){return handleRouteError(error);}}
