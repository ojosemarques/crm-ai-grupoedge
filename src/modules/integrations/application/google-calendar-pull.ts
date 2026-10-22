import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";

type GoogleEventDate = Readonly<{ date?: unknown; dateTime?: unknown; timeZone?: unknown }>;
type GoogleEventPerson = Readonly<{ email?: unknown; displayName?: unknown }>;
type GoogleEventAttendee = Readonly<{ email?: unknown; responseStatus?: unknown }>;
type GoogleConferenceData = Readonly<{ entryPoints?: unknown }>;

export type GoogleCalendarEventPayload = Readonly<{
  id?: unknown;
  etag?: unknown;
  status?: unknown;
  summary?: unknown;
  location?: unknown;
  htmlLink?: unknown;
  hangoutLink?: unknown;
  visibility?: unknown;
  eventType?: unknown;
  start?: GoogleEventDate | unknown;
  end?: GoogleEventDate | unknown;
  creator?: GoogleEventPerson | unknown;
  attendees?: readonly GoogleEventAttendee[] | unknown;
  updated?: unknown;
  conferenceData?: GoogleConferenceData | unknown;
}>;

export type NormalizedGoogleCalendarEvent = Readonly<
  | {
      kind: "DELETED";
      externalEventId: string;
      externalEtag: string | null;
    }
  | {
      kind: "ACTIVE";
      externalEventId: string;
      externalEtag: string | null;
      title: string;
      location: string | null;
      startsAt: Date;
      endsAt: Date;
      allDay: boolean;
      timeZone: string;
      externalStatus: string;
      visibility: string;
      eventType: string;
      htmlLink: string | null;
      conferenceUrl: string | null;
      creatorName: string | null;
      creatorEmail: string | null;
      attendees: readonly Readonly<{ email: string; responseStatus: string }>[];
      sourceUpdatedAt: Date | null;
    }
>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function safeHttpsUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function validTimeZone(value: unknown, fallback: string): string {
  const candidate = text(value, 120) ?? fallback;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return fallback;
  }
}

function instant(value: unknown): Date | null {
  const candidate = text(value, 100);
  if (!candidate) return null;
  const result = new Date(candidate);
  return Number.isNaN(result.getTime()) ? null : result;
}

function eventDate(value: unknown, fallbackTimeZone: string): Readonly<{ instant: Date; allDay: boolean; timeZone: string }> | null {
  const row = object(value);
  if (!row) return null;
  const timeZone = validTimeZone(row.timeZone, fallbackTimeZone);
  const dateTime = instant(row.dateTime);
  if (dateTime) return { instant: dateTime, allDay: false, timeZone };
  const date = text(row.date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    return { instant: parseWorkspaceLocalDateTime(`${date}T00:00`, timeZone), allDay: true, timeZone };
  } catch {
    return null;
  }
}

function conferenceUrl(event: Record<string, unknown>) {
  const direct = safeHttpsUrl(event.hangoutLink);
  if (direct) return direct;
  const conference = object(event.conferenceData);
  const entryPoints = Array.isArray(conference?.entryPoints) ? conference.entryPoints : [];
  for (const item of entryPoints) {
    const entryPoint = object(item);
    if (entryPoint?.entryPointType !== "video") continue;
    const url = safeHttpsUrl(entryPoint.uri);
    if (url) return url;
  }
  return null;
}

function attendees(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const attendee = object(item);
    const email = text(attendee?.email, 320)?.toLowerCase();
    if (!email || !email.includes("@") || /[\s\u0000-\u001f\u007f]/u.test(email)) return [];
    return [{ email, responseStatus: text(attendee?.responseStatus, 40) ?? "unknown" }];
  }).slice(0, 200);
}

export function normalizeGoogleCalendarEvent(
  input: GoogleCalendarEventPayload,
  fallbackTimeZone: string,
): NormalizedGoogleCalendarEvent {
  const event = object(input);
  const externalEventId = text(event?.id, 1_024);
  if (!event || !externalEventId) throw new Error("GOOGLE_CALENDAR_EVENT_INVALID");
  const externalEtag = text(event.etag, 300);
  if (event.status === "cancelled") return { kind: "DELETED", externalEventId, externalEtag };

  const starts = eventDate(event.start, fallbackTimeZone);
  const ends = eventDate(event.end, starts?.timeZone ?? fallbackTimeZone);
  if (!starts || !ends || ends.instant <= starts.instant) throw new Error("GOOGLE_CALENDAR_EVENT_TIME_INVALID");
  const creator = object(event.creator);
  const sourceUpdatedAt = instant(event.updated);

  return Object.freeze({
    kind: "ACTIVE" as const,
    externalEventId,
    externalEtag,
    title: text(event.summary, 200) ?? "(Sem título)",
    location: text(event.location, 500),
    startsAt: starts.instant,
    endsAt: ends.instant,
    allDay: starts.allDay,
    timeZone: starts.timeZone,
    externalStatus: text(event.status, 40) ?? "confirmed",
    visibility: text(event.visibility, 40) ?? "default",
    eventType: text(event.eventType, 80) ?? "default",
    htmlLink: safeHttpsUrl(event.htmlLink),
    conferenceUrl: conferenceUrl(event),
    creatorName: text(creator?.displayName, 200),
    creatorEmail: text(creator?.email, 320)?.toLowerCase() ?? null,
    attendees: attendees(event.attendees),
    sourceUpdatedAt,
  });
}
