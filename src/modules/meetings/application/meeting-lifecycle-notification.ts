import type { MeetingStatus, Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  canNotifyMeetingActivity,
  enqueueMeetingInternalNotificationsInTransaction,
  MEETING_LIFECYCLE_NOTIFICATION_KIND,
  meetingNotificationActor,
} from "./meeting-booking-notification";

type LifecycleEvent = "RESCHEDULED" | "CANCELLED" | "COMPLETED";
type MeetingChange = Readonly<{
  previousStatus: MeetingStatus;
  status: MeetingStatus;
  previousStartsAt: Date;
  previousEndsAt: Date;
  startsAt: Date;
  endsAt: Date;
}>;

export function meetingLifecycleNotificationEvent(change: MeetingChange): LifecycleEvent | null {
  if (change.status === "CANCELLED" && change.previousStatus !== "CANCELLED") return "CANCELLED";
  if (change.status === "COMPLETED" && change.previousStatus !== "COMPLETED") return "COMPLETED";
  if ((change.status === "SCHEDULED" || change.status === "CONFIRMED") && (
    change.startsAt.getTime() !== change.previousStartsAt.getTime() || change.endsAt.getTime() !== change.previousEndsAt.getTime()
  )) return "RESCHEDULED";
  return null;
}

type LifecycleInput = MeetingChange & Readonly<{
  context: AuthenticatedContext;
  meetingId: string;
  meetingRevision: number;
  leadName: string;
  closerName: string;
  title: string;
  timeZone: string;
  occurredAt: Date;
}>;

export function buildMeetingLifecycleNotification(input: LifecycleInput, event: LifecycleEvent) {
  const { role, name } = meetingNotificationActor(input.context);
  const actor = `${role[0]}${role.slice(1).toLocaleLowerCase("pt-BR")} ${name}`;
  const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const date = (value: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, dateStyle: "short" }).format(value);
  const time = (value: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, timeStyle: "short" }).format(value);
  const when = (value: Date) => `${date(value)} às ${time(value)}`;
  const slot = (start: Date, end: Date) => `${when(start)} até ${when(end)}`;
  const details = `Com quem: ${input.leadName}\nReunião: ${input.title}\nVendedor responsável: ${input.closerName}`;
  const footer = `Fuso: ${input.timeZone}\n\nAviso automático do CRM Politizai.`;
  if (event === "RESCHEDULED") return {
    subject: `${actor} - Reunião com ${clean(input.leadName)} remarcada`,
    text: `${actor} remarcou a reunião.\n\n${details}\n\nDe: ${slot(input.previousStartsAt, input.previousEndsAt)}\nPara: ${slot(input.startsAt, input.endsAt)}\nRemarcação registrada em: ${when(input.occurredAt)}\n${footer}`,
  };
  if (event === "CANCELLED") return {
    subject: `${actor} - Reunião com ${clean(input.leadName)} cancelada`,
    text: `${actor} cancelou a reunião.\n\n${details}\n\nHorário que estava agendado: ${slot(input.previousStartsAt, input.previousEndsAt)}\nCancelamento registrado em: ${when(input.occurredAt)}\n${footer}`,
  };
  return {
    subject: `Vendedor ${clean(input.closerName)} - Reunião realizada com ${clean(input.leadName)}`,
    text: `Reunião realizada com ${input.leadName}.\n\n${details}\nResponsável pela realização: ${input.closerName}\nData e horário da reunião na agenda: ${slot(input.startsAt, input.endsAt)}\nResultado registrado por: ${actor}\nRealização registrada em: ${when(input.occurredAt)}\n${footer}`,
  };
}

export async function scheduleMeetingLifecycleNotificationsInTransaction(transaction: Prisma.TransactionClient, input: LifecycleInput) {
  if (!canNotifyMeetingActivity(input.context)) return;
  const event = meetingLifecycleNotificationEvent(input);
  if (!event) return;
  await enqueueMeetingInternalNotificationsInTransaction(transaction, {
    context: input.context,
    occurredAt: input.occurredAt,
    idempotencyPrefix: `meeting-lifecycle-notification:${input.meetingId}:r${input.meetingRevision}:${event.toLowerCase()}`,
    payload: {
      kind: MEETING_LIFECYCLE_NOTIFICATION_KIND,
      emailKind: `${event}_NOTIFICATION`,
      meetingId: input.meetingId,
      meetingRevision: input.meetingRevision,
      reminderMinutes: null,
      ...buildMeetingLifecycleNotification(input, event),
    },
  });
}
