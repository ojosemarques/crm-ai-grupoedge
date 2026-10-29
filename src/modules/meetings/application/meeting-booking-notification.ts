import { createHash } from "node:crypto";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { AccessRoleKeys } from "@/modules/users/permissions/permission-keys";
import { isWorkspaceMeetingScheduler } from "@/modules/users/permissions/meeting-scheduler-policy";

export const MEETING_BOOKING_NOTIFICATION_KIND = "MEETING_BOOKING_NOTIFICATION_V1";
export const MEETING_LIFECYCLE_NOTIFICATION_KIND = "MEETING_LIFECYCLE_NOTIFICATION_V1";
export const MEETING_BOOKING_NOTIFICATION_SENDER = "noreply@politizai.com";
export const MEETING_BOOKING_NOTIFICATION_RECIPIENTS = [
  "ejosemarquess@gmail.com",
  "mattheusmendon@gmail.com",
  "oswaldomuller701@gmail.com",
] as const;

export const meetingBookingNotificationSchema = z.object({
  kind: z.literal(MEETING_BOOKING_NOTIFICATION_KIND),
  emailKind: z.literal("BOOKING_NOTIFICATION"),
  meetingId: z.string().uuid(),
  meetingRevision: z.literal(1),
  reminderMinutes: z.null(),
  recipientEmail: z.enum(MEETING_BOOKING_NOTIFICATION_RECIPIENTS),
  subject: z.string().min(1).max(500).regex(/^[^\r\n]+$/),
  text: z.string().min(1).max(5000),
});

export type MeetingBookingNotificationPayload = z.infer<typeof meetingBookingNotificationSchema>;
export const meetingLifecycleNotificationSchema = meetingBookingNotificationSchema.extend({
  kind: z.literal(MEETING_LIFECYCLE_NOTIFICATION_KIND),
  emailKind: z.enum(["RESCHEDULED_NOTIFICATION", "CANCELLED_NOTIFICATION", "COMPLETED_NOTIFICATION"]),
  meetingRevision: z.number().int().positive(),
});
export const meetingInternalNotificationSchema = z.discriminatedUnion("kind", [meetingBookingNotificationSchema, meetingLifecycleNotificationSchema]);
export type MeetingInternalNotificationPayload = z.infer<typeof meetingInternalNotificationSchema>;

export function canNotifyMeetingActivity(context: AuthenticatedContext) {
  return context.workspaceSlug === "politizai" && (
    context.roleKey === AccessRoleKeys.CLOSER || context.roleKey === AccessRoleKeys.SDR || isWorkspaceMeetingScheduler(context)
  );
}

export function meetingNotificationActor(scheduler: Pick<AuthenticatedContext, "displayName" | "roleKey" | "email" | "workspaceSlug">) {
  const role = scheduler.roleKey === AccessRoleKeys.SDR || isWorkspaceMeetingScheduler(scheduler)
    ? "PRÉ-VENDEDOR"
    : scheduler.roleKey === AccessRoleKeys.ADMINISTRATOR ? "ADMINISTRADOR"
      : scheduler.roleKey === AccessRoleKeys.COMMERCIAL_MANAGER ? "GESTOR" : "VENDEDOR";
  return { role, name: scheduler.displayName.replace(/[\r\n]+/g, " ").trim() };
}

export function buildMeetingBookingNotification(input: Readonly<{
  scheduler: Pick<AuthenticatedContext, "displayName" | "roleKey" | "email" | "workspaceSlug">;
  leadName: string;
  closerName: string;
  title: string;
  startsAt: Date;
  timeZone: string;
}>) {
  const { role, name } = meetingNotificationActor(input.scheduler);
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, dateStyle: "short" }).format(input.startsAt);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, timeStyle: "short" }).format(input.startsAt);
  return {
    subject: `${role} ${name.toLocaleUpperCase("pt-BR")} AGENDOU UMA REUNIÃO`,
    text: `${role} ${name} agendou uma reunião.\n\nCom quem: ${input.leadName}\nReunião: ${input.title}\nData: ${date}\nHorário: ${time} (${input.timeZone})\nVendedor responsável pela reunião: ${input.closerName}\n\nAviso automático do CRM Politizai.`,
  };
}

export async function scheduleMeetingBookingNotificationsInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    context: AuthenticatedContext;
    meetingId: string;
    leadName: string;
    closerName: string;
    title: string;
    startsAt: Date;
    timeZone: string;
    occurredAt: Date;
  }>,
) {
  if (!canNotifyMeetingActivity(input.context)) return;
  const content = buildMeetingBookingNotification({ ...input, scheduler: input.context });
  await enqueueMeetingInternalNotificationsInTransaction(transaction, {
    context: input.context,
    occurredAt: input.occurredAt,
    idempotencyPrefix: `meeting-booking-notification:${input.meetingId}`,
    payload: { kind: MEETING_BOOKING_NOTIFICATION_KIND, emailKind: "BOOKING_NOTIFICATION", meetingId: input.meetingId, meetingRevision: 1, reminderMinutes: null, ...content },
  });
}

export async function enqueueMeetingInternalNotificationsInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    context: AuthenticatedContext;
    occurredAt: Date;
    idempotencyPrefix: string;
    payload: Omit<MeetingInternalNotificationPayload, "recipientEmail">;
  }>,
) {
  for (const recipientEmail of MEETING_BOOKING_NOTIFICATION_RECIPIENTS) {
    const recipientKey = createHash("sha256").update(recipientEmail).digest("hex").slice(0, 24);
    const idempotencyKey = `${input.idempotencyPrefix}:${recipientKey}`;
    const payload = meetingInternalNotificationSchema.parse({
      ...input.payload,
      recipientEmail,
    });
    await transaction.job.upsert({
      where: { workspaceId_idempotencyKey: { workspaceId: input.context.workspaceId, idempotencyKey } },
      update: {},
      create: {
        workspaceId: input.context.workspaceId,
        type: "NOTIFICATION",
        status: "PENDING",
        idempotencyKey,
        priority: 94,
        runAt: input.occurredAt,
        maxAttempts: 5,
        payload,
        createdByActorId: input.context.actorId,
        updatedByActorId: input.context.actorId,
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      },
    });
  }
}
