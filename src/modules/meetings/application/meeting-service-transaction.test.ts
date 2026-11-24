import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";

const dependencies = vi.hoisted(() => ({
  recordMetric: vi.fn().mockResolvedValue({ fact: {}, idempotent: false }),
  scheduleParticipantEmails: vi.fn(),
  enqueueGoogleSync: vi.fn(),
}));

vi.mock("@/modules/metrics/application/commercial-metric-fact-writer", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/metrics/application/commercial-metric-fact-writer")>(),
  recordCommercialMetricFactInTransaction: dependencies.recordMetric,
}));
vi.mock("@/modules/meetings/application/meeting-participant-email-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/meetings/application/meeting-participant-email-service")>(),
  scheduleMeetingParticipantEmailsInTransaction: dependencies.scheduleParticipantEmails,
}));
vi.mock("@/modules/integrations/application/google-calendar-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/integrations/application/google-calendar-service")>(),
  enqueueGoogleCalendarSyncInTransaction: dependencies.enqueueGoogleSync,
}));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const leadId = "33333333-3333-4333-8333-333333333333";
const memberId = "44444444-4444-4444-8444-444444444444";

const context = {
  sessionId: "55555555-5555-4555-8555-555555555555",
  workspaceId,
  workspaceSlug: "grupo-edge",
  userId: "66666666-6666-4666-8666-666666666666",
  memberId,
  actorId: "77777777-7777-4777-8777-777777777777",
  roleId: "88888888-8888-4888-8888-888888888888",
  roleKey: "ADMIN",
  roleName: "Administrador",
  displayName: "Gestor",
  email: "gestor@example.test",
} satisfies AuthenticatedContext;

describe("transação de resultado da reunião", () => {
  it("reserva tempo suficiente para persistir o resultado atômico no Worker", async () => {
    const transaction = vi.fn().mockResolvedValue({ meetingId, status: "COMPLETED", revision: 2 });
    const database = {
      meeting: {
        findFirst: vi.fn().mockResolvedValue({
          id: meetingId,
          leadId,
          ownerMemberId: memberId,
          status: "CONFIRMED",
          startsAt: new Date("2026-11-18T12:00:00.000Z"),
          endsAt: new Date("2026-11-18T12:30:00.000Z"),
          timeZone: "America/Sao_Paulo",
          revision: 1,
          lead: {
            ownerMemberId: memberId,
            queueId: null,
            routingQueue: null,
            queue: null,
          },
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const authorization = {
      authorize: vi.fn().mockResolvedValue({ allowed: true, scope: "ALL" }),
      assertAuthorized: vi.fn(),
    };
    const service = createMeetingService({
      database,
      authorization,
      now: () => new Date("2026-11-18T13:00:00.000Z"),
    });

    await service.act(context, {
      action: "ATTENDED",
      meetingId,
      expectedRevision: 1,
      outcome: "Resumo persistido após a reunião.",
      nextAction: {
        title: "Enviar proposta",
        dueAtLocal: "2026-11-18T11:00",
      },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    });
  });

  it("remarca o agendamento público na mesma reunião e registra só a métrica de remarcação", async () => {
    dependencies.recordMetric.mockClear();
    dependencies.scheduleParticipantEmails.mockClear();
    dependencies.enqueueGoogleSync.mockClear();
    const oldStart = new Date("2026-11-25T13:00:00.000Z");
    const newStart = new Date("2026-11-26T14:00:00.000Z");
    const meeting = {
      id: meetingId,
      workspaceId,
      leadId,
      opportunityId: null,
      ownerMemberId: memberId,
      title: "Reunião de diagnóstico",
      status: "CONFIRMED",
      startsAt: oldStart,
      endsAt: new Date("2026-11-25T14:00:00.000Z"),
      durationMinutes: 60,
      revision: 1,
      googleCalendarLink: { memberId },
      participants: [{ email: "lead@example.test" }],
      lead: { ownerMemberId: memberId },
    };
    const transaction = {
      meeting: {
        findFirst: vi.fn().mockResolvedValueOnce(meeting).mockResolvedValueOnce(null),
        update: vi.fn().mockResolvedValue({ revision: 2 }),
        create: vi.fn(),
      },
      meetingHistory: { create: vi.fn().mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" }) },
      task: { updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: "task", title: "Reunião", dueAt: newStart }) },
      lead: { update: vi.fn() },
      opportunity: { update: vi.fn() },
      activity: { create: vi.fn().mockResolvedValue({ id: "activity" }) },
      auditLog: { create: vi.fn() },
    };
    const service = createMeetingService({
      database: {} as PrismaClient,
      authorization: { authorize: vi.fn(), assertAuthorized: vi.fn() },
      now: () => new Date("2026-11-24T13:00:00.000Z"),
    });

    const result = await service.rescheduleFromPublicForm(transaction as never, {
      workspaceId,
      actorId: context.actorId,
    }, { meetingId, leadId, startsAt: newStart });

    expect(result).toMatchObject({ meetingId, revision: 2, startsAt: newStart });
    expect(transaction.meeting.create).not.toHaveBeenCalled();
    expect(transaction.meeting.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: meetingId },
      data: expect.objectContaining({ startsAt: newStart, revision: { increment: 1 } }),
    }));
    expect(dependencies.recordMetric).toHaveBeenCalledOnce();
    expect(dependencies.recordMetric).toHaveBeenCalledWith(transaction, expect.objectContaining({
      eventType: "MEETING_RESCHEDULED",
      meetingId,
    }));
    expect(dependencies.scheduleParticipantEmails).toHaveBeenCalledWith(transaction, expect.objectContaining({ meetingId, startsAt: newStart }));
    expect(dependencies.enqueueGoogleSync).toHaveBeenCalledWith(transaction, expect.objectContaining({ meetingId, meetingRevision: 2 }));
  });
});
