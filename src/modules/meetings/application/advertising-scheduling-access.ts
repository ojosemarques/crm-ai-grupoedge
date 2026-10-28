import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { canScheduleAdvertisingMeeting } from "@/modules/meetings/domain/advertising-scheduling-policy";
import { isWorkspaceMeetingScheduler } from "@/modules/users/permissions/meeting-scheduler-policy";
import { ApplicationError } from "@/shared/core/errors/application-error";

export async function getAdvertisingSchedulingAccess(transaction: Prisma.TransactionClient, context: Pick<AuthenticatedContext, "workspaceId" | "actorId">) {
  const actor = await transaction.actor.findFirstOrThrow({ where: { id: context.actorId, workspaceId: context.workspaceId }, select: { type: true, userId: true, user: { select: { normalizedEmail: true } }, workspace: { select: { slug: true } } } });
  if (actor.type !== "HUMAN") return "AUTHORIZED_SERVICE";
  const member = await transaction.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, userId: actor.userId!, status: "ACTIVE", deletedAt: null }, select: { role: { select: { key: true } }, teamMemberships: { where: { deletedAt: null, team: { deletedAt: null } }, select: { function: true } } } });
  const workspaceScheduler = isWorkspaceMeetingScheduler({ workspaceSlug: actor.workspace.slug, ...(actor.user?.normalizedEmail ? { email: actor.user.normalizedEmail } : {}) });
  const sdr = member?.role.key === "sdr" || member?.teamMemberships.some((membership) => membership.function === "SDR");
  if (!member || !canScheduleAdvertisingMeeting(member.role.key, workspaceScheduler || Boolean(sdr))) return null;
  return sdr ? "SDR" : workspaceScheduler ? "WORKSPACE_SCHEDULER" : "ADMINISTRATIVE_EXCEPTION";
}

export async function assertAdvertisingSchedulingAccess(transaction: Prisma.TransactionClient, context: Pick<AuthenticatedContext, "workspaceId" | "actorId">) {
  const access = await getAdvertisingSchedulingAccess(transaction, context);
  if (!access) throw new ApplicationError("Em Anúncios, o SDR agenda e o vendedor realiza a reunião.", { code: "ADVERTISING_SCHEDULER_REQUIRED", statusCode: 403, expose: true });
  return access;
}
