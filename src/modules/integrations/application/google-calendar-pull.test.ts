import { describe, expect, it } from "vitest";

import { normalizeGoogleCalendarEvent } from "@/modules/integrations/application/google-calendar-pull";

describe("normaliza eventos recebidos do Google Calendar", () => {
  it("preserva horário, origem e links seguros de um evento comum", () => {
    const event = normalizeGoogleCalendarEvent({
      id: "google-event-001",
      etag: '"etag-1"',
      status: "confirmed",
      summary: "Reunião externa",
      location: "Sala 2",
      htmlLink: "https://calendar.google.com/calendar/event?eid=abc",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      visibility: "default",
      start: { dateTime: "2035-02-20T09:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2035-02-20T10:00:00-03:00", timeZone: "America/Sao_Paulo" },
      creator: { email: "vendedor@example.com", displayName: "Vendedor" },
      updated: "2035-02-19T12:00:00.000Z",
    }, "America/Sao_Paulo");

    expect(event).toMatchObject({
      kind: "ACTIVE",
      externalEventId: "google-event-001",
      title: "Reunião externa",
      location: "Sala 2",
      allDay: false,
      timeZone: "America/Sao_Paulo",
      externalStatus: "confirmed",
      creatorName: "Vendedor",
      creatorEmail: "vendedor@example.com",
      htmlLink: "https://calendar.google.com/calendar/event?eid=abc",
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
    });
    if (event.kind !== "ACTIVE") throw new Error("Evento deveria estar ativo.");
    expect(event.startsAt.toISOString()).toBe("2035-02-20T12:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2035-02-20T13:00:00.000Z");
  });

  it("converte evento de dia inteiro no fuso da agenda", () => {
    const event = normalizeGoogleCalendarEvent({
      id: "google-event-all-day",
      status: "confirmed",
      summary: "Evento de dia inteiro",
      start: { date: "2035-02-20" },
      end: { date: "2035-02-21" },
    }, "America/Sao_Paulo");

    expect(event.kind).toBe("ACTIVE");
    if (event.kind !== "ACTIVE") throw new Error("Evento deveria estar ativo.");
    expect(event.allDay).toBe(true);
    expect(event.startsAt.toISOString()).toBe("2035-02-20T03:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2035-02-21T03:00:00.000Z");
  });

  it("aceita exclusões incrementais sem exigir datas", () => {
    expect(normalizeGoogleCalendarEvent({
      id: "google-event-deleted",
      status: "cancelled",
      etag: '"etag-deleted"',
    }, "America/Sao_Paulo")).toEqual({
      kind: "DELETED",
      externalEventId: "google-event-deleted",
      externalEtag: '"etag-deleted"',
    });
  });

  it("descarta protocolos inseguros vindos do provedor", () => {
    const event = normalizeGoogleCalendarEvent({
      id: "google-event-unsafe-link",
      status: "confirmed",
      summary: "Evento",
      htmlLink: "javascript:alert(1)",
      hangoutLink: "data:text/html,unsafe",
      start: { dateTime: "2035-02-20T09:00:00Z" },
      end: { dateTime: "2035-02-20T09:30:00Z" },
    }, "UTC");

    expect(event).toMatchObject({ kind: "ACTIVE", htmlLink: null, conferenceUrl: null });
  });
});
