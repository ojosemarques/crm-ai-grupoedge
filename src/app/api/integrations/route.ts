import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getIntegrationOutboxWorkerService } from "@/modules/integrations/application/integration-outbox-worker-service";
import { getIntegrationPlatformService } from "@/modules/integrations/application/integration-platform-service";
import { connectionCommandSchema, createConnectionSchema, fieldMappingVersionSchema, mappingInputSchema, resolveMappingConflictSchema, updateConnectionSchema } from "@/modules/integrations/domain/integration-contracts";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { readLimitedJson } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), data: createConnectionSchema }).strict(),
  z.object({ action: z.literal("UPDATE"), data: updateConnectionSchema }).strict(),
  z.object({ action: z.literal("COMMAND"), data: connectionCommandSchema }).strict(),
  z.object({ action: z.literal("MAP_OBJECT"), data: mappingInputSchema }).strict(),
  z.object({ action: z.literal("RESOLVE_MAPPING"), data: resolveMappingConflictSchema }).strict(),
  z.object({ action: z.literal("VERSION_FIELDS"), data: fieldMappingVersionSchema }).strict(),
  z.object({ action: z.literal("PROCESS_OUTBOX"), workerId: z.string().trim().regex(/^manual-[a-z0-9-]{4,60}$/) }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    return NextResponse.json({ result: await getIntegrationPlatformService().list(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const body = bodySchema.parse(await readLimitedJson(request, 128 * 1024));
    const service = getIntegrationPlatformService();
    let result: unknown;
    if (body.action === "CREATE") result = await service.create(context, body.data);
    else if (body.action === "UPDATE") result = await service.update(context, body.data);
    else if (body.action === "MAP_OBJECT") result = await service.recognizeMapping(context, body.data);
    else if (body.action === "RESOLVE_MAPPING") result = await service.resolveMappingConflict(context, body.data);
    else if (body.action === "VERSION_FIELDS") result = await service.createFieldMappingVersion(context, body.data);
    else if (body.action === "PROCESS_OUTBOX") {
      await service.assertCanExecute(context);
      result = await getIntegrationOutboxWorkerService().processNext(body.workerId);
    } else {
      const command = body.data;
      if (command.action === "TEST") result = await service.testLocal(context, command.connectionId);
      else if (command.action === "PAUSE") result = await service.setPaused(context, command.connectionId, command.revision, true);
      else if (command.action === "ACTIVATE_LOCAL") result = await service.setPaused(context, command.connectionId, command.revision, false);
      else if (command.action === "LINK_SECRET_REFERENCE") result = await service.linkSecretReference(context, command);
      else if (command.action === "RUN_SYNC") result = await service.runSync(context, { connectionId: command.connectionId, direction: command.direction, objectType: command.objectType, correlationId: command.correlationId, ...(command.leadId ? { leadId: command.leadId } : {}) });
      else result = await service.replay(context, command);
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
