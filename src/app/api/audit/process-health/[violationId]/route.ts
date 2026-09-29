import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getAuditAdministrationService } from "@/modules/audit/application/audit-administration-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuditRouteContext = Readonly<{ params: Promise<{ violationId: string }> }>;

export async function PATCH(
  request: NextRequest,
  context: AuditRouteContext,
) {
  try {
    assertSameOrigin(request);
    const authenticated = await requireApiAuthentication(request);
    const parsedId = z.string().uuid().safeParse((await context.params).violationId);
    if (!parsedId.success) {
      throw new ApplicationError("Achado de processo não encontrado.", {
        code: "PROCESS_VIOLATION_NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }
    return NextResponse.json(await getAuditAdministrationService().act(
      authenticated,
      parsedId.data,
      await request.json().catch(() => null),
    ));
  } catch (error) {
    return handleRouteError(error);
  }
}
