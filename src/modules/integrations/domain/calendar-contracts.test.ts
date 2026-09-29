import { describe, expect, it } from "vitest";

import {
  calendarCallbackSchema,
  calendarConfigureSchema,
  calendarDurationMinutes,
  signLocalCalendarCallback,
  verifyLocalCalendarCallback,
} from "@/modules/integrations/domain/calendar-contracts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2047-03-04T15:00:00.000Z");

describe("contratos do calendário local", () => {
  it("assina corpo e timestamp e rejeita adulteração ou replay vencido", () => {
    const timestamp = String(now.getTime());
    const body = Buffer.from('{"eventId":"calendar:event:001"}');
    const signature = signLocalCalendarCallback(workspaceId, timestamp, body);

    expect(verifyLocalCalendarCallback({ workspaceId, timestamp, rawBody: body, signature, now })).toMatchObject({ valid: true });
    expect(verifyLocalCalendarCallback({ workspaceId, timestamp, rawBody: Buffer.from("changed"), signature, now })).toEqual({ valid: false, reason: "SIGNATURE_INVALID" });
    expect(verifyLocalCalendarCallback({ workspaceId, timestamp, rawBody: body, signature, now: new Date(now.getTime() + 301_000) })).toEqual({ valid: false, reason: "TIMESTAMP_EXPIRED" });
  });

  it("exige identidade conhecida na criação e motivo no cancelamento", () => {
    const base = {
      eventId: "calendar:event:002",
      nonce: "calendar:nonce:002",
      externalEventId: "calendar:external:002",
      externalVersion: 1,
      occurredAt: now,
      timeZone: "America/Sao_Paulo",
      origin: "LOCAL_SANDBOX",
    } as const;

    expect(calendarCallbackSchema.safeParse({ ...base, operation: "CREATE" }).success).toBe(false);
    expect(calendarCallbackSchema.safeParse({ ...base, operation: "CANCEL", meetingId: workspaceId }).success).toBe(false);
  });

  it("aceita somente durações oficiais de 30 ou 40 minutos", () => {
    expect(calendarDurationMinutes(now, new Date(now.getTime() + 30 * 60_000))).toBe(30);
    expect(calendarDurationMinutes(now, new Date(now.getTime() + 40 * 60_000))).toBe(40);
    expect(calendarDurationMinutes(now, new Date(now.getTime() + 35 * 60_000))).toBeNull();
  });

  it("limita janelas e lote da configuração local", () => {
    expect(calendarConfigureSchema.safeParse({ displayName: "Agenda local", syncPastDays: 30, syncFutureDays: 180, maxItemsPerRun: 200 }).success).toBe(true);
    expect(calendarConfigureSchema.safeParse({ displayName: "Agenda local", syncPastDays: -1, syncFutureDays: 0, maxItemsPerRun: 501 }).success).toBe(false);
  });
});
