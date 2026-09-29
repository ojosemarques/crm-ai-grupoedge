import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { mediaBackfillSchema, mediaImportConfirmSchema, mediaImportPreviewSchema, mediaImportRollbackSchema, mediaReconciliationSchema } from "@/modules/marketing/domain/media-performance";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action:z.literal("PREVIEW_IMPORT"),data:mediaImportPreviewSchema }).strict(),
  z.object({ action:z.literal("CONFIRM_IMPORT"),data:mediaImportConfirmSchema }).strict(),
  z.object({ action:z.literal("ROLLBACK_IMPORT"),data:mediaImportRollbackSchema }).strict(),
  z.object({ action:z.literal("BACKFILL_HIERARCHY"),data:mediaBackfillSchema }).strict(),
  z.object({ action:z.literal("RECONCILE"),data:mediaReconciliationSchema }).strict(),
]);

export async function GET(request:NextRequest){try{const context=await requireApiAuthentication(request);return NextResponse.json({result:await getMediaPerformanceService().getScreen(context,Object.fromEntries(request.nextUrl.searchParams.entries()))},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiAuthentication(request);const body=bodySchema.parse(await readLimitedJson(request,600*1024));const service=getMediaPerformanceService();const result=body.action==="PREVIEW_IMPORT"?await service.previewImport(context,body.data):body.action==="CONFIRM_IMPORT"?await service.confirmImport(context,body.data):body.action==="ROLLBACK_IMPORT"?await service.rollbackImport(context,body.data):body.action==="BACKFILL_HIERARCHY"?await service.backfillHierarchy(context,body.data):await service.reconcile(context,body.data);return NextResponse.json({result},{headers:{"Cache-Control":"no-store"}});}catch(error){return handleRouteError(error);}}
