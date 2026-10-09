import { addLocalDays, parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";
import { PROSPECTING_EMAIL_SEQUENCE } from "@/modules/prospecting/domain/prospecting-email-sequence";

export const PROSPECTING_CADENCE_VERSION = 2;

export type ProspectingCadenceDefinition = Readonly<{
  stepKey: string;
  dayNumber: number;
  executor: "SELLER" | "OPEN_DOT" | "CRM_WORKER";
  action: "CALL" | "EMAIL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW" | "CLOSE";
  timeOfDay: string;
}>;

export const PROSPECTING_CADENCE: readonly ProspectingCadenceDefinition[] = Object.freeze([
  { stepKey: "call-1", dayNumber: 1, executor: "SELLER", action: "CALL", timeOfDay: "09:00" },
  { stepKey: "instagram-message-1", dayNumber: 1, executor: "SELLER", action: "INSTAGRAM_MESSAGE", timeOfDay: "09:15" },
  { stepKey: "instagram-follow", dayNumber: 1, executor: "SELLER", action: "INSTAGRAM_FOLLOW", timeOfDay: "09:30" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[0].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[0].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[1].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[1].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: "instagram-message-2", dayNumber: 8, executor: "SELLER", action: "INSTAGRAM_MESSAGE", timeOfDay: "09:00" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[2].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[2].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: "call-2", dayNumber: 10, executor: "SELLER", action: "CALL", timeOfDay: "10:00" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[3].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[3].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: "instagram-message-3", dayNumber: 16, executor: "SELLER", action: "INSTAGRAM_MESSAGE", timeOfDay: "09:00" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[4].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[4].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: "call-3", dayNumber: 19, executor: "SELLER", action: "CALL", timeOfDay: "10:00" },
  { stepKey: "instagram-message-4", dayNumber: 24, executor: "SELLER", action: "INSTAGRAM_MESSAGE", timeOfDay: "09:00" },
  { stepKey: PROSPECTING_EMAIL_SEQUENCE[5].stepKey, dayNumber: PROSPECTING_EMAIL_SEQUENCE[5].dayOffset + 1, executor: "OPEN_DOT", action: "EMAIL", timeOfDay: "10:00" },
  { stepKey: "call-4", dayNumber: 27, executor: "SELLER", action: "CALL", timeOfDay: "10:00" },
  { stepKey: "close-no-response", dayNumber: 30, executor: "CRM_WORKER", action: "CLOSE", timeOfDay: "18:00" },
]);

export const D1_GATE_STEP_KEYS = Object.freeze(["call-1", "instagram-message-1", "instagram-follow"] as const);

export const ACCEPTED_MANUAL_RESULTS = Object.freeze({
  CALL: ["CONNECTED", "CALLBACK_REQUESTED", "WHATSAPP_SHARED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "CHANNEL_UNAVAILABLE"],
  INSTAGRAM_MESSAGE: ["SENT", "FAILED", "PROFILE_NOT_FOUND", "CHANNEL_UNAVAILABLE"],
  INSTAGRAM_FOLLOW: ["COMPLETED", "ALREADY_FOLLOWING", "FAILED", "PROFILE_NOT_FOUND", "CHANNEL_UNAVAILABLE"],
} as const);

const AUTOMATIC_RESULT_REASONS: Readonly<Record<string, string>> = Object.freeze({
  WRONG_NUMBER: "Número incorreto informado pelo vendedor.",
  CHANNEL_UNAVAILABLE: "Canal indisponível informado pelo vendedor.",
  FAILED: "Falha informada pelo vendedor.",
  PROFILE_NOT_FOUND: "Perfil não encontrado informado pelo vendedor.",
});

export function resolveProspectingManualResultReason(
  resultCode: string,
  suppliedReason?: string,
): string | null {
  const reason = suppliedReason?.trim();
  return reason || AUTOMATIC_RESULT_REASONS[resultCode] || null;
}

function weekDay(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function isBusinessDate(localDate: string, holidays: ReadonlySet<string>): boolean {
  const day = weekDay(localDate);
  return day !== 0 && day !== 6 && !holidays.has(localDate);
}

export function nextBusinessDate(localDate: string, holidays: ReadonlySet<string>): string {
  let cursor = localDate;
  for (let index = 0; index < 370; index += 1) {
    if (isBusinessDate(cursor, holidays)) return cursor;
    cursor = addLocalDays(cursor, 1);
  }
  throw new Error("PROSPECTING_CALENDAR_UNRESOLVED");
}

export function previousBusinessDate(localDate: string, holidays: ReadonlySet<string>): string {
  let cursor = localDate;
  for (let index = 0; index < 370; index += 1) {
    if (isBusinessDate(cursor, holidays)) return cursor;
    cursor = addLocalDays(cursor, -1);
  }
  throw new Error("PROSPECTING_CALENDAR_UNRESOLVED");
}

export function scheduleProspectingCadence(input: Readonly<{
  d1Date: string;
  timeZone: string;
  holidays: ReadonlySet<string>;
}>): readonly Readonly<ProspectingCadenceDefinition & { localDate: string; scheduledAt: Date }>[] {
  const d30Date = addLocalDays(input.d1Date, 29);
  return PROSPECTING_CADENCE.map((definition) => {
    const nominal = addLocalDays(input.d1Date, definition.dayNumber - 1);
    const next = nextBusinessDate(nominal, input.holidays);
    const localDate = next > d30Date
      ? previousBusinessDate(d30Date, input.holidays)
      : next;
    return {
      ...definition,
      localDate,
      scheduledAt: parseWorkspaceLocalDateTime(`${localDate}T${definition.timeOfDay}`, input.timeZone),
    };
  });
}

export function manualCapacityDates(input: Readonly<{
  d1Date: string;
  holidays: ReadonlySet<string>;
}>): readonly string[] {
  const dates = PROSPECTING_CADENCE
    .filter((step) => step.executor === "SELLER")
    .map((step) => {
      const d30 = addLocalDays(input.d1Date, 29);
      const next = nextBusinessDate(addLocalDays(input.d1Date, step.dayNumber - 1), input.holidays);
      return next > d30 ? previousBusinessDate(d30, input.holidays) : next;
    });
  return [...new Set(dates)];
}
