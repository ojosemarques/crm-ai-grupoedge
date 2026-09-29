import { NextRequest, NextResponse } from "next/server";

import { getAccountService } from "@/modules/accounts/application/account-service";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = Readonly<{ params: Promise<{ accountId: string }> }>;

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiAuthentication(request);
    const { accountId } = await routeContext.params;
    return NextResponse.json({ result: await getAccountService().get(context, accountId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const { accountId } = await routeContext.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) throw new ApplicationError("Ação inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    const payload = body as Record<string, unknown>;
    const action = String(payload.action);
    const input = { ...payload };
    delete input.action;
    const service = getAccountService();
    const result = action === "UPDATE" ? await service.update(context, accountId, input)
      : action === "INACTIVATE" ? await service.inactivate(context, accountId, Number(input.expectedRevision), String(input.reason ?? ""))
        : action === "ADD_ROLE" ? await service.addRole(context, { ...input, accountId })
          : action === "END_ROLE" ? await service.endRole(context, String(input.roleId), String(input.reason ?? ""))
            : action === "CHANGE_ROLE" ? await service.changeRole(context, input)
            : action === "CREATE_COMMITTEE" ? await service.createCommittee(context, { ...input, accountId })
              : action === "ADD_COMMITTEE_MEMBER" ? await service.addCommitteeMember(context, input)
                : action === "LINK_LEAD" || action === "LINK_OPPORTUNITY"
                  ? await service.link(context, { ...input, accountId })
                  : action === "UNLINK_LEAD" || action === "UNLINK_OPPORTUNITY"
                    ? await service.link(context, { ...input, accountId: null })
                    : (() => { throw new ApplicationError("Ação de conta não suportada.", { code: "INVALID_INPUT", statusCode: 400, expose: true }); })();
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
