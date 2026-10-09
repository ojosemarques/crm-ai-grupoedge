import { ApplicationError } from "@/shared/core/errors/application-error";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export const prospectingMetricsPeriodPresets = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "MONTH",
  "LAST_30_DAYS",
  "CUSTOM",
] as const;

export type ProspectingMetricsPeriodPreset = (typeof prospectingMetricsPeriodPresets)[number];

export type ProspectingMetricsPeriod = Readonly<{
  preset: ProspectingMetricsPeriodPreset;
  fromDate: string;
  toDate: string;
  start: Date;
  end: Date;
  timeZone: string;
}>;

function invalidPeriod(message: string): never {
  throw new ApplicationError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function assertLocalDate(value: string | undefined, field: string): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) invalidPeriod(`Informe uma ${field} válida.`);
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (instant.toISOString().slice(0, 10) !== value) invalidPeriod(`Informe uma ${field} válida.`);
  return value;
}

function period(
  preset: ProspectingMetricsPeriodPreset,
  fromDate: string,
  toDate: string,
  start: Date,
  end: Date,
  timeZone: string,
): ProspectingMetricsPeriod {
  return Object.freeze({ preset, fromDate, toDate, start, end, timeZone });
}

export function resolveProspectingMetricsPeriod(
  preset: ProspectingMetricsPeriodPreset,
  fromDate: string | undefined,
  toDate: string | undefined,
  now: Date,
  timeZone: string,
): ProspectingMetricsPeriod {
  const today = workspaceDateAt(now, timeZone);

  if (preset === "TODAY") {
    return period(preset, today, today, workspaceDayRange(today, timeZone).start, now, timeZone);
  }

  if (preset === "YESTERDAY") {
    const yesterday = addLocalDays(today, -1);
    const range = workspaceDayRange(yesterday, timeZone);
    return period(preset, yesterday, yesterday, range.start, range.end, timeZone);
  }

  if (preset === "LAST_7_DAYS" || preset === "LAST_30_DAYS") {
    const days = preset === "LAST_7_DAYS" ? 7 : 30;
    const firstDate = addLocalDays(today, -(days - 1));
    return period(preset, firstDate, today, workspaceDayRange(firstDate, timeZone).start, now, timeZone);
  }

  if (preset === "MONTH") {
    const firstDate = `${today.slice(0, 7)}-01`;
    return period(preset, firstDate, today, workspaceDayRange(firstDate, timeZone).start, now, timeZone);
  }

  const customFrom = assertLocalDate(fromDate, "data inicial");
  const customTo = assertLocalDate(toDate, "data final");
  if (customFrom > customTo) invalidPeriod("A data inicial deve ser anterior ou igual à data final.");
  if (customTo > today) invalidPeriod("A data final não pode estar no futuro.");

  const calendarDays = Math.round((Date.parse(`${customTo}T00:00:00.000Z`) - Date.parse(`${customFrom}T00:00:00.000Z`)) / 86_400_000) + 1;
  if (calendarDays > 366) invalidPeriod("O período personalizado pode ter no máximo 366 dias.");

  const start = workspaceDayRange(customFrom, timeZone).start;
  const end = customTo === today ? now : workspaceDayRange(customTo, timeZone).end;
  return period(preset, customFrom, customTo, start, end, timeZone);
}
