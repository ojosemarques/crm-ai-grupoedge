import { ApplicationError } from "@/shared/core/errors/application-error";

type LocalParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}>;

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function invalidDate(): never {
  throw new ApplicationError("Data e horário local inválidos.", {
    code: "INVALID_LOCAL_DATE_TIME",
    statusCode: 400,
    expose: true,
  });
}

function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new ApplicationError("Fuso horário do workspace inválido.", {
      code: "INVALID_TIME_ZONE",
      statusCode: 500,
      expose: true,
    });
  }
}

function partsAt(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(instant).flatMap((part) =>
      part.type === "literal" ? [] : [[part.type, Number(part.value)]],
    ),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  } as LocalParts;
}

function desiredUtc(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function parseWorkspaceLocalDateTime(value: string, timeZone: string): Date {
  const match = localDateTimePattern.exec(value);
  if (!match) invalidDate();
  const desired: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const nativeCheck = new Date(desiredUtc(desired));
  if (
    nativeCheck.getUTCFullYear() !== desired.year ||
    nativeCheck.getUTCMonth() + 1 !== desired.month ||
    nativeCheck.getUTCDate() !== desired.day ||
    desired.hour > 23 ||
    desired.minute > 59
  ) invalidDate();

  let timestamp = desiredUtc(desired);
  for (let index = 0; index < 3; index += 1) {
    const actual = partsAt(new Date(timestamp), timeZone);
    timestamp += desiredUtc(desired) - desiredUtc(actual);
  }
  const result = new Date(timestamp);
  if (JSON.stringify(partsAt(result, timeZone)) !== JSON.stringify(desired)) invalidDate();
  return result;
}

export function workspaceDateAt(instant: Date, timeZone: string): string {
  const parts = partsAt(instant, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function addWorkspaceCalendarDays(
  instant: Date,
  days: number,
  timeZone: string,
): Date {
  const local = partsAt(instant, timeZone);
  const date = addLocalDays(
    `${local.year.toString().padStart(4, "0")}-${local.month.toString().padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`,
    days,
  );
  const result = parseWorkspaceLocalDateTime(
    `${date}T${local.hour.toString().padStart(2, "0")}:${local.minute.toString().padStart(2, "0")}`,
    timeZone,
  );
  return days === 0 && result < instant ? instant : result;
}

export function addLocalDays(localDate: string, days: number): string {
  const match = localDatePattern.exec(localDate);
  if (!match) invalidDate();
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${instant.getUTCFullYear().toString().padStart(4, "0")}-${(instant.getUTCMonth() + 1).toString().padStart(2, "0")}-${instant.getUTCDate().toString().padStart(2, "0")}`;
}

export function workspaceDayRange(localDate: string, timeZone: string): Readonly<{ start: Date; end: Date }> {
  return {
    start: parseWorkspaceLocalDateTime(`${localDate}T00:00`, timeZone),
    end: parseWorkspaceLocalDateTime(`${addLocalDays(localDate, 1)}T00:00`, timeZone),
  };
}

export function workspaceWeekRange(localDate: string, timeZone: string): Readonly<{ start: Date; end: Date; startDate: string; endDate: string }> {
  const match = localDatePattern.exec(localDate);
  if (!match) invalidDate();
  const dayOfWeek = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  const monday = addLocalDays(localDate, -((dayOfWeek + 6) % 7));
  const nextMonday = addLocalDays(monday, 7);
  return {
    start: parseWorkspaceLocalDateTime(`${monday}T00:00`, timeZone),
    end: parseWorkspaceLocalDateTime(`${nextMonday}T00:00`, timeZone),
    startDate: monday,
    endDate: addLocalDays(nextMonday, -1),
  };
}
