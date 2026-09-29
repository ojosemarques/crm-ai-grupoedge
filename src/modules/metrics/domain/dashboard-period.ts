import type {
  DashboardPeriodInterval,
  DashboardPeriodPreset,
  DashboardQuery,
} from "@/modules/metrics/domain/dashboard-contracts";
import {
  addLocalDays,
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
  workspaceDayRange,
  workspaceWeekRange,
} from "@/shared/core/time/workspace-time";
import { ApplicationError } from "@/shared/core/errors/application-error";

function invalidPeriod(message: string): never {
  throw new ApplicationError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function monthParts(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) invalidPeriod("Data de referência inválida.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function monthRange(localDate: string, timeZone: string) {
  const { year, month } = monthParts(localDate);
  const fromDate = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const nextDate = `${next.getUTCFullYear().toString().padStart(4, "0")}-${(next.getUTCMonth() + 1).toString().padStart(2, "0")}-01`;
  return {
    fromDate,
    toDate: addLocalDays(nextDate, -1),
    from: parseWorkspaceLocalDateTime(`${fromDate}T00:00`, timeZone),
    to: parseWorkspaceLocalDateTime(`${nextDate}T00:00`, timeZone),
  };
}

function shiftInstantByCalendarDays(instant: Date, days: number, timeZone: string): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).flatMap((part) => part.type === "literal" ? [] : [[part.type, part.value]]));
  const shiftedDate = addLocalDays(
    `${parts.year}-${parts.month}-${parts.day}`,
    days,
  );
  const minute = parseWorkspaceLocalDateTime(
    `${shiftedDate}T${parts.hour}:${parts.minute}`,
    timeZone,
  );
  return new Date(minute.getTime() + Number(parts.second) * 1_000 + instant.getUTCMilliseconds());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousMonthStart(localDate: string): string {
  const { year, month } = monthParts(localDate);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear().toString().padStart(4, "0")}-${(previous.getUTCMonth() + 1).toString().padStart(2, "0")}-01`;
}

function previousMonthEquivalentEnd(instant: Date, timeZone: string): Date {
  const localDate = workspaceDateAt(instant, timeZone);
  const { year, month, day } = monthParts(localDate);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previous.getUTCFullYear();
  const previousMonth = previous.getUTCMonth() + 1;
  const previousDay = Math.min(day, daysInMonth(previousYear, previousMonth));
  const currentDayStart = workspaceDayRange(localDate, timeZone).start;
  const millisecondsIntoDay = instant.getTime() - currentDayStart.getTime();
  const previousDate = `${previousYear.toString().padStart(4, "0")}-${previousMonth.toString().padStart(2, "0")}-${previousDay.toString().padStart(2, "0")}`;
  return new Date(workspaceDayRange(previousDate, timeZone).start.getTime() + millisecondsIntoDay);
}

function isCompleteCalendarMonth(query: DashboardQuery): boolean {
  const { year, month, day } = monthParts(query.fromDate);
  if (day !== 1) return false;
  return query.toDate === `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${daysInMonth(year, month).toString().padStart(2, "0")}`;
}

function interval(
  fromDate: string,
  toDate: string,
  from: Date,
  to: Date,
  timeZone: string,
): DashboardPeriodInterval {
  return Object.freeze({
    fromDate,
    toDate,
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone,
  });
}

export function resolveDashboardPeriod(
  preset: DashboardPeriodPreset,
  fromDate: string | undefined,
  toDate: string | undefined,
  now: Date,
  timeZone: string,
): Pick<DashboardQuery, "preset" | "fromDate" | "toDate" | "from" | "to"> {
  const today = workspaceDateAt(now, timeZone);
  if (preset === "TODAY") {
    const range = workspaceDayRange(today, timeZone);
    return { preset, fromDate: today, toDate: today, from: range.start.toISOString(), to: now.toISOString() };
  }
  if (preset === "YESTERDAY") {
    const yesterday = addLocalDays(today, -1);
    const range = workspaceDayRange(yesterday, timeZone);
    return { preset, fromDate: yesterday, toDate: yesterday, from: range.start.toISOString(), to: range.end.toISOString() };
  }
  if (preset === "WEEK") {
    const range = workspaceWeekRange(today, timeZone);
    return { preset, fromDate: range.startDate, toDate: today, from: range.start.toISOString(), to: now.toISOString() };
  }
  if (preset === "MONTH") {
    const range = monthRange(today, timeZone);
    return { preset, fromDate: range.fromDate, toDate: today, from: range.from.toISOString(), to: now.toISOString() };
  }
  if (!fromDate || !toDate) invalidPeriod("Informe as datas inicial e final do período personalizado.");
  const start = workspaceDayRange(fromDate, timeZone).start;
  const end = workspaceDayRange(toDate, timeZone).end;
  if (start >= end) invalidPeriod("A data inicial deve ser anterior ou igual à data final.");
  const maximumEnd = workspaceDayRange(addLocalDays(fromDate, 366), timeZone).end;
  if (end > maximumEnd) invalidPeriod("O período personalizado pode ter no máximo 366 dias.");
  return { preset, fromDate, toDate, from: start.toISOString(), to: end.toISOString() };
}

export function resolveDashboardComparisonPeriod(
  query: DashboardQuery,
  timeZone: string,
): DashboardPeriodInterval {
  const currentFrom = new Date(query.from);
  const currentTo = new Date(query.to);
  if (query.preset === "TODAY" || query.preset === "YESTERDAY") {
    const from = shiftInstantByCalendarDays(currentFrom, -1, timeZone);
    const to = shiftInstantByCalendarDays(currentTo, -1, timeZone);
    const fromDate = addLocalDays(query.fromDate, -1);
    return interval(fromDate, fromDate, from, to, timeZone);
  }
  if (query.preset === "WEEK") {
    return interval(
      addLocalDays(query.fromDate, -7),
      addLocalDays(query.toDate, -7),
      shiftInstantByCalendarDays(currentFrom, -7, timeZone),
      shiftInstantByCalendarDays(currentTo, -7, timeZone),
      timeZone,
    );
  }
  if (query.preset === "MONTH") {
    const fromDate = previousMonthStart(query.fromDate);
    const to = previousMonthEquivalentEnd(currentTo, timeZone);
    return interval(fromDate, workspaceDateAt(to, timeZone), workspaceDayRange(fromDate, timeZone).start, to, timeZone);
  }
  if (isCompleteCalendarMonth(query)) {
    const fromDate = previousMonthStart(query.fromDate);
    const range = monthRange(fromDate, timeZone);
    return interval(range.fromDate, range.toDate, range.from, range.to, timeZone);
  }
  const currentStartDay = workspaceDayRange(query.fromDate, timeZone).start;
  const localDayCount = Math.round(
    (Date.parse(`${query.toDate}T00:00:00.000Z`) - Date.parse(`${query.fromDate}T00:00:00.000Z`)) / 86_400_000,
  ) + 1;
  const fromDate = addLocalDays(query.fromDate, -localDayCount);
  const toDate = addLocalDays(query.fromDate, -1);
  return interval(
    fromDate,
    toDate,
    workspaceDayRange(fromDate, timeZone).start,
    currentStartDay,
    timeZone,
  );
}
