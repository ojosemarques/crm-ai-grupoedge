import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const listSchema = z.object({
  status: z.enum(["ALL", "UNREAD", "READ"]).default("ALL"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).passthrough();

const markSchema = z.object({ notificationId: z.string().uuid() }).strict();

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(
    error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

export function createNotificationService(options: Readonly<{
  database: PrismaClient;
  now: () => Date;
}>) {
  async function list(context: AuthenticatedContext, input: unknown) {
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const rows = await options.database.notification.findMany({
      where: {
        workspaceId: context.workspaceId,
        recipientMemberId: context.memberId,
        deletedAt: null,
        ...(parsed.data.status === "UNREAD" ? { readAt: null } : {}),
        ...(parsed.data.status === "READ" ? { readAt: { not: null } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit,
      select: {
        id: true,
        leadId: true,
        opportunityId: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
        lead: { select: { fullName: true, deletedAt: true } },
        opportunity: { select: { name: true, deletedAt: true } },
        automationRun: {
          select: { id: true, status: true, rule: { select: { name: true } } },
        },
      },
    });
    const unread = await options.database.notification.count({
      where: {
        workspaceId: context.workspaceId,
        recipientMemberId: context.memberId,
        readAt: null,
        deletedAt: null,
      },
    });
    return Object.freeze({
      generatedAt: options.now().toISOString(),
      status: parsed.data.status,
      unread,
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        relatedLabel: row.lead?.deletedAt === null
          ? row.lead.fullName
          : row.opportunity?.deletedAt === null
            ? row.opportunity.name
            : null,
        href: row.leadId ? `/leads/${row.leadId}/historico` : row.opportunityId ? "/oportunidades" : null,
        automation: row.automationRun
          ? { id: row.automationRun.id, status: row.automationRun.status, ruleName: row.automationRun.rule.name }
          : null,
      })),
    });
  }

  async function markRead(context: AuthenticatedContext, input: unknown) {
    const parsed = markSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const notification = await options.database.notification.findFirst({
      where: {
        id: parsed.data.notificationId,
        workspaceId: context.workspaceId,
        recipientMemberId: context.memberId,
        deletedAt: null,
      },
      select: { id: true, readAt: true },
    });
    if (!notification) {
      throw new ApplicationError("Notificação não encontrada.", {
        code: "NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }
    if (notification.readAt) return { id: notification.id, readAt: notification.readAt.toISOString(), changed: false };
    const readAt = options.now();
    return options.database.$transaction(async (transaction) => {
      const updated = await transaction.notification.update({
        where: { id: notification.id },
        data: { readAt },
        select: { id: true, readAt: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "notification.read",
          entityType: "Notification",
          entityId: notification.id,
          occurredAt: readAt,
          changes: { before: { readAt: null }, after: { readAt: readAt.toISOString() } },
        },
      });
      return { id: updated.id, readAt: updated.readAt!.toISOString(), changed: true };
    });
  }

  return Object.freeze({ list, markRead });
}

export type NotificationScreen = Awaited<
  ReturnType<ReturnType<typeof createNotificationService>["list"]>
>;

let service: ReturnType<typeof createNotificationService> | undefined;

export function getNotificationService() {
  service ??= createNotificationService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
