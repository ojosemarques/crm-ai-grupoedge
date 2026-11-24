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

import { environmentSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { createQuizAgendaToken, parseQuizAgendaToken, verifyQuizAgendaToken, verifyQuizAgendaTokenSignature } from "../domain/quiz-agenda-token";

import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";

const nativeConnectionKey = "meta-native-leads";
const nativeFormPrefix = "meta-native:";
const nativeIdentity = z.object({ name: z.string().trim().min(3).max(200), phone: z.string().trim().min(10).max(25) }).strict();
const receiptSchema = z.uuid();
const bookingSchema = z.object({ startsAt: z.iso.datetime() }).strict();
const rescheduleSchema = bookingSchema.extend({ action: z.literal("RESCHEDULE") }).strict();
const receiptLifetime = 72 * 60 * 60_000;
const rotationAction = "marketing_form.agenda_shared_slot";
const contactPhone = "5562982661279";

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
  if (!receiptSchema.safeParse(publicId).success) return resolveQuizReceipt(db, publicId, now);
  const receipts = await db.marketingFormReceipt.findMany({
    where: { publicId, status: "ACCEPTED", redirectKind: "AGENDA", deletedAt: null },
    take: 2,
    select: { id: true, marketingFormId: true, marketingFormVersionId: true, workspaceId: true, acceptedAt: true },
  });
  const receipt = receipts[0];
  if (!receipt || receipts.length !== 1) invalidReceipt();
  const { workspaceId } = receipt;
  const [form, submission, actor] = await Promise.all([
    db.marketingForm.findFirst({ where: { id: receipt.marketingFormId, workspaceId, status: "ACTIVE", archivedAt: null, deletedAt: null }, select: { id: true } }),
    db.leadFormSubmission.findFirst({
      where: {
        workspaceId, marketingFormId: receipt.marketingFormId, marketingFormReceiptId: receipt.id,
        lead: { deletedAt: null },
      },
      select: { leadId: true, normalizedEmail: true, lead: { select: { currentStage: { select: { leadStageCode: true } } } } },
    }),
    db.actor.findFirst({
      where: { workspaceId, type: "SYSTEM", key: "system", userId: null, workspace: { status: "ACTIVE", deletedAt: null } },
      select: { id: true },
    }),
  ]);
  if (!submission?.leadId || !actor) invalidReceipt();
  const persistent = await hasPersistentPublicMeeting(db, workspaceId, submission.leadId, actor.id);
  const leadStage = submission.lead?.currentStage.leadStageCode;
  if (!persistent && (!form || leadStage === "CLIENT" || leadStage === "DISQUALIFIED"
    || !receipt.acceptedAt || receipt.acceptedAt < new Date(now.getTime() - receiptLifetime))) invalidReceipt();
  return { workspaceId, destination: { kind: "FORM" as const, formId: receipt.marketingFormId, versionId: receipt.marketingFormVersionId }, actorId: actor.id, leadId: submission.leadId, participantEmail: participantEmailSchema.safeParse(submission.normalizedEmail).data ?? null };
}

async function hasPersistentPublicMeeting(db: Prisma.TransactionClient, workspaceId: string, leadId: string, actorId: string) {
  return Boolean(await db.meeting.findFirst({
    where: { workspaceId, leadId, createdByActorId: actorId, title: PUBLIC_AGENDA_TITLE, deletedAt: null },
    select: { id: true },
  }));
}

async function agendaConnection(db: Prisma.TransactionClient, key: string, providerKey: "FORM" | "META_LEAD_ADS") {
  const connection = await db.integrationConnection.findFirst({
    where: { key, providerKey, enabled: true, disabledAt: null, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] }, workspace: { slug: "politizai", status: "ACTIVE", deletedAt: null } },
    select: { workspaceId: true, secrets: { where: { alias: "webhook-hmac", present: true, disabledAt: null }, orderBy: { version: "desc" }, take: 1, select: { referenceKey: true } } },
  });
  const reference = connection?.secrets[0]?.referenceKey;
  const secret = reference && await environmentSecretResolver.resolve(reference);
  if (!connection || !secret) invalidReceipt();
  return { workspaceId: connection.workspaceId, secret };
}

export async function submitNativePublicAgenda(raw: unknown) {
  const { startsAt, ...identity } = nativeIdentity.extend({ startsAt: bookingSchema.shape.startsAt.optional() }).parse(raw);
  const receipt = await startNativePublicAgenda(identity);
  return startsAt ? { ...await bookPublicAgenda(receipt, { startsAt }), receipt } : { receipt };
}

export async function startNativePublicAgenda(raw: unknown) {
  const { name, phone } = nativeIdentity.parse(raw);
  const normalized = normalizePhone(phone);
  if (!normalized.success) invalidReceipt();
  const db = getDatabaseClient();
  const { workspaceId, secret } = await agendaConnection(db, nativeConnectionKey, "META_LEAD_ADS");
  const now = new Date();
  const candidates = await db.leadFormSubmission.findMany({
    where: {
      workspaceId, normalizedPhone: normalized.normalizedPhone, formIdentifier: { startsWith: nativeFormPrefix },
      submittedAt: { gte: new Date(now.getTime() - receiptLifetime), lte: now },
      intakeOutcome: { in: ["CREATED", "ATTACHED"] }, rawPayload: { path: ["provider"], equals: "META_LEAD_ADS" },
      lead: { deletedAt: null, currentStage: { leadStageCode: { notIn: ["CLIENT", "DISQUALIFIED"] } } },
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 10,
    select: { id: true, leadId: true, submittedAt: true, submittedFullName: true },
  });
  const canonicalName = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  const matching = candidates.filter(row => row.submittedFullName && canonicalName(row.submittedFullName) === canonicalName(name));
  const submission = matching[0];
  if (!submission?.leadId || matching.some(row => row.leadId !== submission.leadId)) invalidReceipt();
  return createQuizAgendaToken("meta-native", submission.id, submission.submittedAt, secret);
}

async function resolveQuizReceipt(db: Prisma.TransactionClient, token: string, now: Date) {
  const parsed = parseQuizAgendaToken(token);
  if (!parsed) invalidReceipt();
  const native = parsed.quiz === "meta-native";
  const connectionKey = native ? nativeConnectionKey : `site-${parsed.quiz}`;
  const { workspaceId, secret } = await agendaConnection(db, connectionKey, native ? "META_LEAD_ADS" : "FORM");
  const verified = verifyQuizAgendaToken(token, secret, now);
  if (!verified && !verifyQuizAgendaTokenSignature(token, secret)) invalidReceipt();

  const [submission, actor] = await Promise.all([
    db.leadFormSubmission.findFirst({
      where: { workspaceId, id: parsed.submissionId,
        ...(native ? { formIdentifier: { startsWith: nativeFormPrefix }, rawPayload: { path: ["provider"], equals: "META_LEAD_ADS" } } : { formIdentifier: connectionKey }),
        lead: { deletedAt: null } },
      select: { leadId: true, normalizedEmail: true, lead: { select: { currentStage: { select: { leadStageCode: true } } } } },
    }),
    db.actor.findFirst({ where: { workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true } }),
  ]);
  if (!submission?.leadId || !actor) invalidReceipt();
  const persistent = await hasPersistentPublicMeeting(db, workspaceId, submission.leadId, actor.id);
  const leadStage = submission.lead?.currentStage.leadStageCode;
  if (!persistent && (!verified || leadStage === "CLIENT" || leadStage === "DISQUALIFIED")) invalidReceipt();
  return { workspaceId, destination: native ? { kind: "NATIVE" as const } : { kind: "QUIZ" as const }, actorId: actor.id, leadId: submission.leadId, participantEmail: participantEmailSchema.safeParse(submission.normalizedEmail).data ?? null };
}

type Booking = Awaited<ReturnType<typeof resolveReceipt>>;

async function existingMeeting(db: Prisma.TransactionClient, booking: Booking) {
  return db.meeting.findFirst({
    where: {
      workspaceId: booking.workspaceId,
      leadId: booking.leadId,
      createdByActorId: booking.actorId,
      title: PUBLIC_AGENDA_TITLE,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, ownerMemberId: true, startsAt: true, endsAt: true, durationMinutes: true, status: true, revision: true },
  });
}

type ConfirmationMeeting = Readonly<{
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  status: string;
}>;

function calendarStamp(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function confirmedBooking(meeting: ConfirmationMeeting) {
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, dateStyle: "full" }).format(meeting.startsAt);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, hour: "2-digit", minute: "2-digit" }).format(meeting.startsAt);
  const message = `Olá! Agendei uma demonstração da Politizai para ${date}, às ${time} (horário de Brasília). Gostaria de confirmar meu atendimento.`;
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", PUBLIC_AGENDA_TITLE);
  google.searchParams.set("dates", `${calendarStamp(meeting.startsAt)}/${calendarStamp(meeting.endsAt)}`);
  google.searchParams.set("details", "Demonstração da plataforma Politizai. Nossa equipe entrará em contato para confirmar o atendimento.");
  google.searchParams.set("ctz", PUBLIC_AGENDA_ZONE);
  return {
    booked: true as const,
    confirmation: {
      startsAt: meeting.startsAt.toISOString(),
      endsAt: meeting.endsAt.toISOString(),
      durationMinutes: meeting.durationMinutes,
      timeZone: PUBLIC_AGENDA_ZONE,
      title: PUBLIC_AGENDA_TITLE,
      status: meeting.status,
      canReschedule: meeting.status === "SCHEDULED" || meeting.status === "CONFIRMED",
      whatsappUrl: `https://wa.me/${contactPhone}?text=${encodeURIComponent(message)}`,
      googleCalendarUrl: google.toString(),
    },
  };
}

async function replayBooking(db: Prisma.TransactionClient, booking: Booking) {
  const existing = await existingMeeting(db, booking);
  if (!existing) return null;
  return confirmedBooking(existing);
}

async function googleAvailability(workspaceId: string, start: Date, end: Date, ownerMemberId?: string) {
  const database = getDatabaseClient();
  const members = await database.workspaceMember.findMany({
    where: {
      ...commercialMemberWhere({ workspaceId, functions: ["CLOSER"] }),
      ...(ownerMemberId ? { id: ownerMemberId } : {}),
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

async function crmAvailability(db: Prisma.TransactionClient, workspaceId: string, sellers: Seller[], start: Date, end: Date, excludeMeetingId?: string) {
  return db.meeting.findMany({
    where: {
      workspaceId, ownerMemberId: { in: sellers.map(({ id }) => id) }, deletedAt: null,
      status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { lt: end }, endsAt: { gt: start },
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
    },
    select: { ownerMemberId: true, startsAt: true, endsAt: true },
  });
}

function eligible(slot: AgendaSlot, sellers: Seller[], meetings: (BusyInterval & { ownerMemberId: string })[]) {
  return sellers.filter(({ id, opensAt, intervals }) =>
    isSellerAvailable(slot, opensAt, intervals) && isSellerAvailable(slot, opensAt, meetings.filter((meeting) => meeting.ownerMemberId === id)));
}

export async function listPublicAgenda(publicId: string, options: { reschedule?: boolean } = {}) {
  const database = getDatabaseClient();
  const now = new Date();
  const booking = await resolveReceipt(database, publicId, now);
  const { today, days, slots } = publicAgendaWindow(now);
  const meeting = await existingMeeting(database, booking);
  if (meeting) {
    if (options.reschedule && (meeting.status === "SCHEDULED" || meeting.status === "CONFIRMED")) {
      return listOpenSlots(database, booking.workspaceId, { today, days, slots }, { ownerMemberId: meeting.ownerMemberId, excludeMeetingId: meeting.id, rescheduling: true });
    }
    return { today, days, slots: [], ...confirmedBooking(meeting) };
  }
  return listOpenSlots(database, booking.workspaceId, { today, days, slots });
}

export async function listNativePublicAgenda() {
  const database = getDatabaseClient();
  const { workspaceId } = await agendaConnection(database, nativeConnectionKey, "META_LEAD_ADS");
  return listOpenSlots(database, workspaceId, publicAgendaWindow(new Date()));
}

async function listOpenSlots(
  database: Prisma.TransactionClient,
  workspaceId: string,
  { today, days, slots }: ReturnType<typeof publicAgendaWindow>,
  options: { ownerMemberId?: string; excludeMeetingId?: string; rescheduling?: boolean } = {},
) {
  const start = slots[0]!.startsAt;
  const end = slots.at(-1)!.endsAt;
  const sellers = await googleAvailability(workspaceId, start, end, options.ownerMemberId);
  const meetings = await crmAvailability(database, workspaceId, sellers, start, end, options.excludeMeetingId);
  return {
    today, days, booked: false, rescheduling: options.rescheduling ?? false,
    slots: slots.filter((slot) => slot.startsAt.getTime() > Date.now() && eligible(slot, sellers, meetings).length > 0)
      .map(({ day, startsAt }) => ({ day, startsAt: startsAt.toISOString() })),
  };
}

export async function bookPublicAgenda(publicId: string, raw: unknown) {
  if (rescheduleSchema.safeParse(raw).success) return reschedulePublicAgenda(publicId, raw);
  const database = getDatabaseClient();
  const { startsAt } = bookingSchema.parse(raw);
  const now = new Date();
  const booking = await resolveReceipt(database, publicId, now);
  const prior = await replayBooking(database, booking);
  if (prior) return prior;
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
    const concurrent = await replayBooking(tx, current);
    if (concurrent) return concurrent;
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
    return confirmedBooking({ startsAt: slot.startsAt, endsAt: slot.endsAt, durationMinutes: Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000), status: "SCHEDULED" });
  }, { timeout: 15_000 });
}

async function reschedulePublicAgenda(publicId: string, raw: unknown) {
  const database = getDatabaseClient();
  const { startsAt } = rescheduleSchema.parse(raw);
  const booking = await resolveReceipt(database, publicId, new Date());
  const meeting = await existingMeeting(database, booking);
  if (!meeting || (meeting.status !== "SCHEDULED" && meeting.status !== "CONFIRMED")) invalidReceipt();
  if (meeting.startsAt.toISOString() === startsAt) return confirmedBooking(meeting);
  const slot = publicAgendaWindow(new Date()).slots.find((candidate) => candidate.startsAt.toISOString() === startsAt);
  if (!slot) slotTaken();
  const sellers = await googleAvailability(booking.workspaceId, slot.startsAt, slot.endsAt, meeting.ownerMemberId);
  if (!sellers.length) slotTaken();

  return database.$transaction(async (tx) => {
    const current = await resolveReceipt(tx, publicId, new Date());
    const currentMeeting = await existingMeeting(tx, current);
    if (!currentMeeting || currentMeeting.id !== meeting.id || (currentMeeting.status !== "SCHEDULED" && currentMeeting.status !== "CONFIRMED")) invalidReceipt();
    await lockCloser(tx, current.workspaceId, currentMeeting.ownerMemberId);
    const meetings = await crmAvailability(tx, current.workspaceId, sellers, slot.startsAt, slot.endsAt, currentMeeting.id);
    if (!eligible(slot, sellers, meetings).length) slotTaken();
    const result = await getMeetingService().rescheduleFromPublicForm(tx, current, {
      meetingId: currentMeeting.id,
      leadId: current.leadId,
      startsAt: slot.startsAt,
    });
    return confirmedBooking({
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      durationMinutes: currentMeeting.durationMinutes,
      status: "SCHEDULED",
    });
  }, { timeout: 15_000 });
}
