import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";

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
});
