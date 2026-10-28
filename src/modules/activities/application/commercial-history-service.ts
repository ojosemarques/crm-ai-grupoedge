import { ActivityResult, ActivityType, type Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { leadVisibilityWhere, resolveLeadVisibilityScope } from "@/modules/leads/application/lead-list-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const schema = z.object({
  pipelineName: z.enum(["Anúncios", "Prospecção Ativa"]),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  type: z.enum(ActivityType).optional(), result: z.enum(ActivityResult).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
}).strict();

export function createCommercialHistoryService(options: Readonly<{
  database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>;
}>) {
  async function getHistory(context: AuthenticatedContext, input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApplicationError("Filtros do histórico inválidos.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    const query = parsed.data;
    if (query.from && query.to && query.from >= query.to) throw new ApplicationError("O início deve preceder o fim.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    const scope = await resolveLeadVisibilityScope(options.database, options.authorization, context, PermissionKeys.LEADS_READ);
    const where: Prisma.ActivityWhereInput = {
      workspaceId: context.workspaceId, deletedAt: null,
      ...(query.type ? { type: query.type } : {}), ...(query.result ? { result: query.result } : {}),
      ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
      lead: { workspaceId: context.workspaceId, deletedAt: null, pipeline: { name: query.pipelineName, workspaceId: context.workspaceId }, AND: [leadVisibilityWhere(context, scope)] },
    };
    const [total, items] = await Promise.all([
      options.database.activity.count({ where }),
      options.database.activity.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * 25, take: 25,
        select: { id: true, type: true, subject: true, result: true, occurredAt: true,
          createdBy: { select: { displayName: true } },
          lead: { select: { id: true, fullName: true, pipeline: { select: { name: true } }, owner: { select: { user: { select: { displayName: true } } } } } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: 25, items: items.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() })) };
  }
  return { getHistory };
}

export function getCommercialHistoryService() {
  return createCommercialHistoryService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
}
