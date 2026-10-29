import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MeetingStatus, Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { meetingLifecycleNotificationSchema } from "./meeting-booking-notification";
import { buildMeetingLifecycleNotification, meetingLifecycleNotificationEvent, scheduleMeetingLifecycleNotificationsInTransaction } from "./meeting-lifecycle-notification";

const input = {
  context: { workspaceId: randomUUID(), workspaceSlug: "politizai", actorId: randomUUID(), roleKey: "closer", displayName: "Carlos Henrique", email: "carloshenrique@politizai.com" } as AuthenticatedContext,
  meetingId: randomUUID(), meetingRevision: 2, leadName: "Jardel", closerName: "Jhon Cunha", title: "Diagnóstico",
  previousStatus: "SCHEDULED" as MeetingStatus, status: "SCHEDULED" as MeetingStatus,
  previousStartsAt: new Date("2035-02-20T15:00:00Z"), previousEndsAt: new Date("2035-02-20T15:30:00Z"),
  startsAt: new Date("2035-02-21T17:00:00Z"), endsAt: new Date("2035-02-21T17:40:00Z"),
  occurredAt: new Date("2035-02-20T13:00:00Z"), timeZone: "America/Sao_Paulo",
};

describe("avisos de alterações nas reuniões", () => {
  it("mostra pré-vendedor e datas completas de origem e destino na remarcação", () => {
    const email = buildMeetingLifecycleNotification(input, "RESCHEDULED");
    expect(email.subject).toBe("Pré-vendedor Carlos Henrique - Reunião com Jardel remarcada");
    expect(email.text).toContain("De: 20/02/2035 às 12:00 até 20/02/2035 às 12:30");
    expect(email.text).toContain("Para: 21/02/2035 às 14:00 até 21/02/2035 às 14:40");
    expect(email.text).toContain("Fuso: America/Sao_Paulo");
  });

  it("informa quem cancelou, o horário cancelado e quando foi registrado", () => {
    const email = buildMeetingLifecycleNotification(input, "CANCELLED");
    expect(email.subject).toBe("Pré-vendedor Carlos Henrique - Reunião com Jardel cancelada");
    expect(email.text).toContain("Horário que estava agendado: 20/02/2035 às 12:00");
    expect(email.text).toContain("Cancelamento registrado em: 20/02/2035 às 10:00");
  });

  it("distingue o vendedor responsável da pessoa que registrou a realização", () => {
    const email = buildMeetingLifecycleNotification({ ...input, occurredAt: new Date("2035-02-21T19:00:00Z") }, "COMPLETED");
    expect(email.subject).toBe("Vendedor Jhon Cunha - Reunião realizada com Jardel");
    expect(email.text).toContain("Responsável pela realização: Jhon Cunha");
    expect(email.text).toContain("Data e horário da reunião na agenda: 21/02/2035 às 14:00");
    expect(email.text).toContain("Resultado registrado por: Pré-vendedor Carlos Henrique");
    expect(email.text).toContain("Realização registrada em: 21/02/2035 às 16:00");
  });

  it("impede quebras de linha no assunto vindo dos nomes", () => {
    const email = buildMeetingLifecycleNotification({ ...input, leadName: "Jardel\r\nTeste", closerName: "Jhon\nCunha" }, "COMPLETED");
    expect(email.subject).toBe("Vendedor Jhon Cunha - Reunião realizada com Jardel Teste");
  });

  it.each([
    ["SCHEDULED", "CANCELLED", "CANCELLED"], ["CONFIRMED", "COMPLETED", "COMPLETED"],
    ["SCHEDULED", "COMPLETED", "COMPLETED"], ["COMPLETED", "COMPLETED", null],
    ["CANCELLED", "CANCELLED", null], ["SCHEDULED", "NO_SHOW", null],
  ] as const)("detecta somente nova mudança de %s para %s", (previousStatus, status, event) => {
    expect(meetingLifecycleNotificationEvent({ ...input, previousStatus, status })).toBe(event);
  });

  it("confirmação, correção do resumo e remarcação sem mudança de horário não duplicam avisos", () => {
    const unchanged = { ...input, startsAt: input.previousStartsAt, endsAt: input.previousEndsAt };
    expect(meetingLifecycleNotificationEvent(unchanged)).toBeNull();
    expect(meetingLifecycleNotificationEvent({ ...unchanged, status: "CONFIRMED" })).toBeNull();
    expect(meetingLifecycleNotificationEvent({ ...unchanged, previousStatus: "COMPLETED", status: "COMPLETED" })).toBeNull();
    expect(meetingLifecycleNotificationEvent({ ...unchanged, endsAt: input.endsAt })).toBe("RESCHEDULED");
  });

  it.each(["SCHEDULED", "CANCELLED", "COMPLETED"] as const)("enfileira três avisos individuais idempotentes para %s", async (status) => {
    const upsert = vi.fn();
    const transaction = { job: { upsert } } as unknown as Prisma.TransactionClient;
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, status });
    expect(upsert).toHaveBeenCalledTimes(3);
    const calls = upsert.mock.calls.map(([call]) => call);
    expect(calls.every((call) => meetingLifecycleNotificationSchema.safeParse(call.create.payload).success)).toBe(true);
    expect(calls.every((call) => call.create.runAt === input.occurredAt && call.create.payload.meetingRevision === 2)).toBe(true);
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, status });
    expect(upsert.mock.calls.slice(3).map(([call]) => call.where)).toEqual(calls.map((call) => call.where));
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, status, meetingRevision: 3 });
    expect(upsert.mock.calls.slice(6).map(([call]) => call.where)).not.toEqual(calls.map((call) => call.where));
  });

  it("ignora outros workspaces, usuários fora do comercial e correções sem nova transição", async () => {
    const upsert = vi.fn();
    const transaction = { job: { upsert } } as unknown as Prisma.TransactionClient;
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, context: { ...input.context, workspaceSlug: "outro" } });
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, context: { ...input.context, roleKey: "viewer", email: "viewer@example.test" } });
    await scheduleMeetingLifecycleNotificationsInTransaction(transaction, { ...input, previousStatus: "COMPLETED", status: "COMPLETED" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
