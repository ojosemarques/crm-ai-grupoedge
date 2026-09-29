export const calendarScenarios = [
  "SUCCESS",
  "TRANSIENT_FAILURE",
  "PERMANENT_FAILURE",
  "TIMEOUT",
] as const;

export type CalendarScenario = (typeof calendarScenarios)[number];

export const calendarOperations = ["CREATE", "UPDATE", "RESCHEDULE", "CANCEL"] as const;
export type CalendarOperation = (typeof calendarOperations)[number];
