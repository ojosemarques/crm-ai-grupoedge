import { randomInt } from "node:crypto";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { createGoogleCalendarWorkerService } from "@/modules/integrations/application/google-calendar-worker-service";
import { getMeetingService, lockCloser } from "@/modules/meetings/application/meeting-service";
import { participantEmailSchema } from "@/modules/meetings/domain/meeting-participants";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  isSellerAvailable, publicAgendaWindow, PUBLIC_AGENDA_SELLERS, PUBLIC_AGENDA_TITLE, PUBLIC_AGENDA_ZONE,
  type AgendaSlot, type BusyInterval,
} from "../domain/public-agenda";

const receiptSchema = z.uuid();
const bookingSchema = z.object({ startsAt: z.iso.datetime() }).strict();
const receiptLifetime = 72 * 60 * 60_000;
const rotationAction = "marketing_form.agenda_shared_slot";

function unavailable() {
  return new ApplicationError("Não foi possível consultar a agenda agora. Tente novamente.", {
    code: "PUBLIC_AGENDA_UNAVAILABLE", statusCode: 503, expose: true,
  });
}

function invalidReceipt(): never {
  throw new ApplicationError("Este link de agendamento não está disponível.", {
    code: "PUBLIC_AGENDA_INVALID", statusCode: 404, expose: true,
  });
}

function slotTaken(): never {
  throw new ApplicationError("Este horário não está mais disponível. Escolha outro.", {
    code: "PUBLIC_AGENDA_SLOT_TAKEN", statusCode: 409, expose: true,
  });
}

async function resolveReceipt(db: Prisma.TransactionClient, publicId: string, now: Date) {
  if (!receiptSchema.safeParse(publicId).success) invalidReceipt();
  const receipts = await db.marketingFormReceipt.findMany({
    where: { publicId, status: "ACCEPTED", redirectKind: "AGENDA", deletedAt: null, acceptedAt: { gte: new Date(now.getTime() - receiptLifetime) } },
    take: 2,
    select: { id: true, marketingFormId: true, workspaceId: true },
  });
  const receipt = receipts[0];
  if (!receipt || receipts.length !== 1) invalidReceipt();
  const { workspaceId } = receipt;
  const [form, submission, actor] = await Promise.all([
    db.marketingForm.findFirst({ where: { id: receipt.marketingFormId, workspaceId, status: "ACTIVE", archivedAt: null, deletedAt: null }, select: { id: true } }),
    db.leadFormSubmission.findFirst({
      where: {
        workspaceId, marketingFormId: receipt.marketingFormId, marketingFormReceiptId: receipt.id,
        lead: { deletedAt: null, currentStage: { leadStageCode: { notIn: ["CLIENT", "DISQUALIFIED"] } } },
      },
      select: { leadId: true, normalizedEmail: true },
    }),
    db.actor.findFirst({
      where: { workspaceId, type: "SYSTEM", key: "system", userId: null, workspace: { status: "ACTIVE", deletedAt: null } },
      select: { id: true },
    }),
  ]);
  if (!form || !submission?.leadId || !actor) invalidReceipt();
  return { workspaceId, actorId: actor.id, leadId: submission.leadId, participantEmail: participantEmailSchema.safeParse(submission.normalizedEmail).data ?? null };
}

type Booking = Awaited<ReturnType<typeof resolveReceipt>>;

async function existingMeeting(db: Prisma.TransactionClient, booking: Booking) {
  return db.meeting.findFirst({
    where: {
      workspaceId: booking.workspaceId, leadId: booking.leadId,
      OR: [{ deletedAt: null }, { createdByActorId: booking.actorId, title: PUBLIC_AGENDA_TITLE }],
    },
    select: { id: true },
  });
}

async function googleAvailability(workspaceId: string, start: Date, end: Date) {
  const database = getDatabaseClient();
  const members = await database.workspaceMember.findMany({
    where: {
      ...commercialMemberWhere({ workspaceId, functions: ["CLOSER"] }),
      user: { status: "ACTIVE", deletedAt: null, normalizedEmail: { in: Object.keys(PUBLIC_AGENDA_SELLERS) } },
    },
    select: { id: true, user: { select: { normalizedEmail: true } } },
  });
  const accounts = await database.googleCalendarAccount.findMany({
    where: { workspaceId, memberId: { in: members.map((member) => member.id) }, status: "CONNECTED", disconnectedAt: null },
  });
  const calendar = createGoogleCalendarWorkerService({ database, now: () => new Date() });
  const results = await Promise.allSettled(accounts.map(async (account) => ({
    id: account.memberId,
    opensAt: PUBLIC_AGENDA_SELLERS[members.find((member) => member.id === account.memberId)!.user.normalizedEmail as keyof typeof PUBLIC_AGENDA_SELLERS],
    intervals: await calendar.readBusyIntervals(account, start, end, PUBLIC_AGENDA_ZONE),
  })));
  const available = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!available.length) throw unavailable();
  return available.sort((left, right) => left.id.localeCompare(right.id));
}

type Seller = Awaited<ReturnType<typeof googleAvailability>>[number];

async function crmAvailability(db: Prisma.TransactionClient, workspaceId: string, sellers: Seller[], start: Date, end: Date) {
  return db.meeting.findMany({
    where: {
      workspaceId, ownerMemberId: { in: sellers.map(({ id }) => id) }, deletedAt: null,
      status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { lt: end }, endsAt: { gt: start },
    },
    select: { ownerMemberId: true, startsAt: true, endsAt: true },
  });
}

function eligible(slot: AgendaSlot, sellers: Seller[], meetings: (BusyInterval & { ownerMemberId: string })[]) {
  return sellers.filter(({ id, opensAt, intervals }) =>
    isSellerAvailable(slot, opensAt, intervals) && isSellerAvailable(slot, opensAt, meetings.filter((meeting) => meeting.ownerMemberId === id)));
}

export async function listPublicAgenda(publicId: string) {
  const database = getDatabaseClient();
  const now = new Date();
  const booking = await resolveReceipt(database, publicId, now);
  const { today, days, slots } = publicAgendaWindow(now);
  if (await existingMeeting(database, booking)) return { today, days, booked: true, slots: [] };
  const start = slots[0]!.startsAt;
  const end = slots.at(-1)!.endsAt;
  const sellers = await googleAvailability(booking.workspaceId, start, end);
  const meetings = await crmAvailability(database, booking.workspaceId, sellers, start, end);
  return {
    today, days, booked: false,
    slots: slots.filter((slot) => slot.startsAt.getTime() > Date.now() && eligible(slot, sellers, meetings).length > 0)
      .map(({ day, startsAt }) => ({ day, startsAt: startsAt.toISOString() })),
  };
}

export async function bookPublicAgenda(publicId: string, raw: unknown) {
  const database = getDatabaseClient();
  const { startsAt } = bookingSchema.parse(raw);
  const now = new Date();
  const booking = await resolveReceipt(database, publicId, now);
  if (await existingMeeting(database, booking)) return { booked: true };
  const slot = publicAgendaWindow(now).slots.find((candidate) => candidate.startsAt.toISOString() === startsAt);
  if (!slot) slotTaken();
  const sellers = (await googleAvailability(booking.workspaceId, slot.startsAt, slot.endsAt)).filter(({ opensAt }) => opensAt <= slot.hour);
  if (!sellers.length) slotTaken();

  return database.$transaction(async (tx) => {
    const current = await resolveReceipt(tx, publicId, new Date());
    if (current.workspaceId !== booking.workspaceId || current.leadId !== booking.leadId) invalidReceipt();
    // Same lock order as internal booking: calendar owners first, then the lead.
    for (const seller of sellers) await lockCloser(tx, current.workspaceId, seller.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-distribution:${current.workspaceId}:${current.leadId}`}, 0))`;
    if (await existingMeeting(tx, current)) return { booked: true };
    if (slot.startsAt.getTime() <= Date.now()) slotTaken();
    const meetings = await crmAvailability(tx, current.workspaceId, sellers, slot.startsAt, slot.endsAt);
    const choices = eligible(slot, sellers, meetings);
    if (!choices.length) slotTaken();
    const last = choices.length > 1 ? await tx.auditLog.findFirst({
      where: { workspaceId: current.workspaceId, action: rotationAction },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { changes: true },
    }) : null;
    const previous = last?.changes as { closerId?: string } | null | undefined;
    const closer = choices.find(({ id }) => previous?.closerId && id !== previous.closerId) ?? choices[randomInt(choices.length)]!;
    const { meetingId } = await getMeetingService().scheduleFromPublicForm(tx, current, {
      leadId: current.leadId, closerId: closer.id, startsAt: slot.startsAt,
      timeZone: PUBLIC_AGENDA_ZONE, participantEmail: current.participantEmail,
    });
    if (choices.length > 1) await tx.auditLog.create({ data: {
      workspaceId: current.workspaceId, actorId: current.actorId, action: rotationAction,
      entityType: "Meeting", entityId: meetingId, changes: { closerId: closer.id },
    } });
    return { booked: true, startsAt };
  }, { timeout: 15_000 });
}
