import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { dailyGoalInputSchema } from "@/modules/goals/domain/daily-goal-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "assertAuthorized">;

export function createDailyGoalService(options: Readonly<{ database: PrismaClient; authorization: AuthorizationPort }>) {
  async function save(context: AuthenticatedContext, payload: unknown) {
    const input = dailyGoalInputSchema.parse(payload);
    await options.authorization.assertAuthorized(context, PermissionKeys.GOALS_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "DailyGoalProfile",
      memberId: input.memberId,
    });
    const member = await options.database.workspaceMember.findFirst({
      where: { id: input.memberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null, user: { deletedAt: null } },
      select: { id: true },
    });
    if (!member) throw new ApplicationError("A pessoa selecionada não está ativa neste workspace.", { code: "NOT_FOUND", statusCode: 404, expose: true });
    const existing = await options.database.dailyGoalProfile.findUnique({
      where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: input.memberId } },
    });
    if ((existing?.revision ?? null) !== input.expectedRevision) {
      throw new ApplicationError("A meta diária foi alterada por outra pessoa. Atualize a página e tente novamente.", { code: "CONFLICT", statusCode: 409, expose: true });
    }
    const values = {
      callsTarget: input.callsTarget,
      messagesTarget: input.messagesTarget,
      effectiveContactsTarget: input.effectiveContactsTarget,
      qualificationsTarget: input.qualificationsTarget,
      meetingsScheduledTarget: input.meetingsScheduledTarget,
      proposalsTarget: input.proposalsTarget,
      salesValueTargetCents: input.salesValueTargetCents,
    };
    return options.database.$transaction(async (tx) => {
      const profile = existing
        ? await tx.dailyGoalProfile.update({ where: { id: existing.id }, data: { ...values, revision: { increment: 1 }, updatedByActorId: context.actorId } })
        : await tx.dailyGoalProfile.create({ data: { workspaceId: context.workspaceId, memberId: input.memberId, ...values, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: existing ? "goals.daily.updated" : "goals.daily.created",
          entityType: "DailyGoalProfile",
          entityId: profile.id,
          changes: { memberId: input.memberId, revision: profile.revision, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])) },
          metadata: { source: "my_day", configuredByManager: true },
        },
      });
      return { ...profile, salesValueTargetCents: profile.salesValueTargetCents.toString() };
    });
  }
  return Object.freeze({ save });
}

let service: ReturnType<typeof createDailyGoalService> | undefined;
export function getDailyGoalService() {
  service ??= createDailyGoalService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
  return service;
}
