import { describe, expect, it } from "vitest";

import {
  CalendarTransportError,
  ExternalCalendarDisabledAdapter,
  LocalCalendarSandboxAdapter,
} from "@/modules/integrations/application/calendar-transport";

const base = {
  meetingId: "11111111-1111-4111-8111-111111111111",
  externalEventId: "local-event:11111111-1111-4111-8111-111111111111",
  operation: "CREATE" as const,
  meetingRevision: 2,
  title: "Reunião de diagnóstico",
  startsAt: new Date("2047-03-04T15:00:00.000Z"),
  endsAt: new Date("2047-03-04T15:30:00.000Z"),
  timeZone: "America/Sao_Paulo",
  status: "SCHEDULED" as const,
};

describe("transporte do calendário local", () => {
  it("projeta resultado determinístico sem egress", async () => {
    await expect(new LocalCalendarSandboxAdapter().push({ ...base, scenario: "SUCCESS", attempt: 1 })).resolves.toEqual({
      externalEventId: base.externalEventId,
      externalVersion: 2,
      externalEtag: `local:${base.meetingId}:r2`,
      appliedOperation: "CREATE",
      simulated: true,
      externalEgress: false,
    });
  });

  it("classifica falha transitória e recupera na terceira tentativa", async () => {
    const adapter = new LocalCalendarSandboxAdapter();
    await expect(adapter.push({ ...base, scenario: "TRANSIENT_FAILURE", attempt: 1 })).rejects.toMatchObject({ code: "CALENDAR_LOCAL_TRANSIENT_FAILURE", retryable: true });
    await expect(adapter.push({ ...base, scenario: "TRANSIENT_FAILURE", attempt: 3 })).resolves.toMatchObject({ simulated: true, externalEgress: false });
  });

  it("diferencia falha permanente e timeout", async () => {
    const adapter = new LocalCalendarSandboxAdapter();
    await expect(adapter.push({ ...base, scenario: "PERMANENT_FAILURE", attempt: 1 })).rejects.toMatchObject({ code: "CALENDAR_LOCAL_PERMANENT_FAILURE", retryable: false });
    await expect(adapter.push({ ...base, scenario: "TIMEOUT", attempt: 1 })).rejects.toMatchObject({ code: "CALENDAR_LOCAL_TIMEOUT", retryable: true });
  });

  it("mantém o adaptador externo fechado por desenho", async () => {
    const adapter = new ExternalCalendarDisabledAdapter();
    expect(adapter.externalEgress).toBe(false);
    await expect(adapter.push()).rejects.toBeInstanceOf(CalendarTransportError);
    await expect(adapter.push()).rejects.toMatchObject({ code: "CALENDAR_EXTERNAL_EGRESS_DISABLED", retryable: false });
  });
});
