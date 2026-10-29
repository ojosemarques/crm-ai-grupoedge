import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  buildMeetingBookingNotification,
  MEETING_BOOKING_NOTIFICATION_KIND,
  MEETING_LIFECYCLE_NOTIFICATION_KIND,
  MEETING_BOOKING_NOTIFICATION_RECIPIENTS,
  meetingBookingNotificationSchema,
  scheduleMeetingBookingNotificationsInTransaction,
} from "./meeting-booking-notification";
import { createMeetingParticipantEmailWorker } from "./meeting-participant-email-service";

const context = {
  workspaceId: randomUUID(), workspaceSlug: "politizai", actorId: randomUUID(),
  displayName: "Jhon Cunha", roleKey: "closer", email: "jhoncunha@politizai.com",
} as AuthenticatedContext;
const booking = {
  context, meetingId: randomUUID(), leadName: "Cliente de teste", closerName: "Ede Rafael",
  title: "Diagnóstico", startsAt: new Date("2035-02-20T15:00:00Z"), timeZone: "America/Sao_Paulo",
  occurredAt: new Date("2035-02-19T12:00:00Z"),
};

describe("avisos internos de agendamento", () => {
  it.each([
    ["closer", "Jhon Cunha", "jhoncunha@politizai.com", "VENDEDOR JHON CUNHA"],
    ["closer", "Ede Rafael", "ederafael@politizai.com", "VENDEDOR EDE RAFAEL"],
    ["sdr", "Pré-vendas", "sdr@example.test", "PRÉ-VENDEDOR PRÉ-VENDAS"],
    ["closer", "Carlos Henrique", "carloshenrique@politizai.com", "PRÉ-VENDEDOR CARLOS HENRIQUE"],
  ])("identifica quem agendou: %s %s", (roleKey, displayName, email, expected) => {
    const content = buildMeetingBookingNotification({ ...booking, scheduler: { ...context, roleKey, displayName, email } });
    expect(content.subject).toBe(`${expected} AGENDOU UMA REUNIÃO`);
    expect(content.text).toContain("Com quem: Cliente de teste");
    expect(content.text).toContain("Data: 20/02/2035");
    expect(content.text).toContain("Horário: 12:00 (America/Sao_Paulo)");
    expect(content.text).toContain("Vendedor responsável pela reunião: Ede Rafael");
  });

  it("cria três jobs individuais e imediatos com chaves estáveis por reunião/destinatário", async () => {
    const upsert = vi.fn();
    const transaction = { job: { upsert } } as unknown as Prisma.TransactionClient;
    await scheduleMeetingBookingNotificationsInTransaction(transaction, booking);
    const first = upsert.mock.calls.map(([call]) => call);
    expect(first).toHaveLength(3);
    expect(first.map((call) => call.create.payload.recipientEmail)).toEqual([...MEETING_BOOKING_NOTIFICATION_RECIPIENTS]);
    expect(new Set(first.map((call) => call.create.idempotencyKey)).size).toBe(3);
    for (const call of first) {
      expect(call.create).toMatchObject({ workspaceId: context.workspaceId, runAt: booking.occurredAt, maxAttempts: 5 });
      expect(call.update).toEqual({});
      expect(meetingBookingNotificationSchema.safeParse(call.create.payload).success).toBe(true);
    }
    await scheduleMeetingBookingNotificationsInTransaction(transaction, booking);
    expect(upsert.mock.calls.slice(3).map(([call]) => call.where)).toEqual(first.map((call) => call.where));
  });

  it("não envia dados de outros workspaces nem cria avisos para usuários fora do comercial", async () => {
    const upsert = vi.fn();
    const transaction = { job: { upsert } } as unknown as Prisma.TransactionClient;
    await scheduleMeetingBookingNotificationsInTransaction(transaction, { ...booking, context: { ...context, workspaceSlug: "outro" } });
    await scheduleMeetingBookingNotificationsInTransaction(transaction, { ...booking, context: { ...context, roleKey: "viewer" } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("remove quebras de linha do nome no assunto", () => {
    const content = buildMeetingBookingNotification({ ...booking, scheduler: { ...context, displayName: "Jhon\r\nCunha" } });
    expect(content.subject).toBe("VENDEDOR JHON CUNHA AGENDOU UMA REUNIÃO");
  });
});

function workerFixture(overrides: { payload?: Record<string, unknown>; workspaceSlug?: string; suppression?: boolean; status?: number; attempts?: number; senderReady?: boolean } = {}) {
  const payload = {
    kind: MEETING_BOOKING_NOTIFICATION_KIND, emailKind: "BOOKING_NOTIFICATION", meetingId: booking.meetingId,
    meetingRevision: 1, reminderMinutes: null, recipientEmail: MEETING_BOOKING_NOTIFICATION_RECIPIENTS[0],
    ...buildMeetingBookingNotification({ ...booking, scheduler: context }), ...overrides.payload,
  };
  const job = { id: randomUUID(), workspaceId: context.workspaceId, payload, attempts: overrides.attempts ?? 1, maxAttempts: 5, updatedByActorId: context.actorId, idempotencyKey: "notice-test-key", runAt: booking.occurredAt, cancelRequestedAt: null };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: job.id }]),
    job: { update: vi.fn().mockResolvedValue(job), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ cancelRequestedAt: null }) },
    meeting: { findFirst: vi.fn().mockResolvedValue({
      id: booking.meetingId, workspace: { slug: overrides.workspaceSlug ?? "politizai" },
      title: "Título alterado", status: "COMPLETED", startsAt: booking.startsAt,
      endsAt: new Date("2035-02-20T16:00:00Z"), timeZone: booking.timeZone,
      participantEmail: null, participants: [], lead: { fullName: "Nome alterado" },
      owner: { user: { displayName: "Outro vendedor" } }, googleCalendarLink: null,
    }) },
    emailConnectionProfile: { findFirst: vi.fn().mockResolvedValue(overrides.senderReady === false ? null : { id: randomUUID(), senderAddressNormalized: "jhoncunha@politizai.com", replyTo: "jhoncunha@politizai.com" }), update: vi.fn() },
    emailSuppression: { findFirst: vi.fn().mockResolvedValue(overrides.suppression ? { id: randomUUID() } : null) },
    auditLog: { create: vi.fn() },
  };
  const database = { ...transaction, $transaction: async (fn: (tx: typeof transaction) => unknown) => fn(transaction) } as unknown as PrismaClient;
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "provider-notice-id" }), { status: overrides.status ?? 200 }));
  const worker = createMeetingParticipantEmailWorker({ database, now: () => new Date("2035-02-21T12:00:00Z"), environment: { MILLIONSEND_ENABLED: "true", MILLIONSEND_API_KEY: "ms_fixture_test_key" }, fetchImpl });
  return { worker, transaction, fetchImpl, job };
}

describe("processamento dos avisos internos pelo MillionSend", () => {
  it.each(["RESCHEDULED_NOTIFICATION", "CANCELLED_NOTIFICATION", "COMPLETED_NOTIFICATION"])("envia %s pelo noreply e audita o evento mesmo com a reunião encerrada", async (emailKind) => {
    const fixture = workerFixture({ payload: { kind: MEETING_LIFECYCLE_NOTIFICATION_KIND, emailKind, meetingRevision: 3, subject: "Alteração da reunião", text: "Retrato da alteração registrada." } });
    await expect(fixture.worker.processNext("test-worker")).resolves.toMatchObject({ status: "SUCCEEDED", emailKind });
    const body = JSON.parse(fixture.fetchImpl.mock.calls[0]![1].body);
    expect(body).toMatchObject({ from: "noreply@politizai.com", to: [MEETING_BOOKING_NOTIFICATION_RECIPIENTS[0]], subject: "Alteração da reunião", text: "Retrato da alteração registrada." });
    expect(fixture.transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "meeting.lifecycle_notification_sent" }) }));
  });

  it("envia o retrato do agendamento sem convidados, mesmo após mudanças na reunião", async () => {
    const fixture = workerFixture();
    await expect(fixture.worker.processNext("test-worker")).resolves.toMatchObject({ status: "SUCCEEDED", emailKind: "BOOKING_NOTIFICATION" });
    const [url, request] = fixture.fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.millionsend.com/emails");
    expect(JSON.parse(request.body)).toMatchObject({
      from: "noreply@politizai.com",
      to: [MEETING_BOOKING_NOTIFICATION_RECIPIENTS[0]],
      subject: "VENDEDOR JHON CUNHA AGENDOU UMA REUNIÃO",
      text: expect.stringContaining("Com quem: Cliente de teste"),
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("reply_to");
    expect(fixture.transaction.emailConnectionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: context.workspaceId, domain: "politizai.com", operatingMode: "EXTERNAL_READY", spfStatus: "VERIFIED_EXTERNAL", dkimStatus: "VERIFIED_EXTERNAL", dmarcStatus: "VERIFIED_EXTERNAL", connection: { enabled: true, providerKey: "MILLIONSEND" } }),
    }));
    expect(fixture.transaction.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: expect.objectContaining({ senderAddress: "noreply@politizai.com" }) }) }));
    expect(request.headers["Idempotency-Key"]).toBe(fixture.job.idempotencyKey);
    expect(fixture.transaction.meeting.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: context.workspaceId }) }));
    expect(fixture.transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "meeting.booking_notification_sent" }) }));
  });

  it.each([
    { workspaceSlug: "outro" },
    { suppression: true },
    { payload: { recipientEmail: "intruso@example.test" } },
    { senderReady: false },
  ])("bloqueia envio não autorizado ou sem remetente validado: %j", async (overrides) => {
    const fixture = workerFixture(overrides);
    expect((await fixture.worker.processNext("test-worker")).status).not.toBe("SUCCEEDED");
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[429, 1, "RETRY_PENDING"], [503, 1, "RETRY_PENDING"], [422, 1, "FAILED"], [429, 5, "FAILED"]])("trata HTTP %s na tentativa %s", async (status, attempts, expected) => {
    const fixture = workerFixture({ status, attempts });
    await expect(fixture.worker.processNext("test-worker")).resolves.toMatchObject({ status: expected });
  });
});
