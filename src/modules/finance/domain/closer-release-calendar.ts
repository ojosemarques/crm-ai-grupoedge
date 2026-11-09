import { firstFifthBusinessDateOnOrAfter } from "@/modules/finance/domain/closer-compensation";
import { nextBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { addLocalDays, workspaceDayRange } from "@/shared/core/time/workspace-time";

export function firstDateOfNextMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number!, 1)).toISOString().slice(0, 10);
}

type VerifiedCalendar = { throughOn: string; holidays: ReadonlySet<string> };

export function resolveCloserReleaseDates(input: {
  cycle: "MONTHLY" | "INSTALLMENT";
  milestoneOn: string;
  evaluatedOn: string;
  timeZone: string;
  calendar: VerifiedCalendar | null;
  previousReleaseOn?: string | undefined;
}) {
  const { calendar, cycle, milestoneOn, evaluatedOn, previousReleaseOn } = input;
  if (!calendar) return { releaseOn: null, eligibleAt: null, dueOn: null };
  let releaseOn = milestoneOn;
  if (cycle === "INSTALLMENT") {
    const firstBusinessOn = nextBusinessDate(milestoneOn, calendar.holidays);
    // Sem observação dos critérios no marco, registra a primeira data útil após a regularização observada.
    releaseOn = previousReleaseOn && previousReleaseOn >= firstBusinessOn
      ? nextBusinessDate(previousReleaseOn, calendar.holidays)
      : evaluatedOn <= firstBusinessOn
        ? firstBusinessOn
        : nextBusinessDate(addLocalDays(evaluatedOn, 1), calendar.holidays);
  }
  const dueDate = firstFifthBusinessDateOnOrAfter(releaseOn, calendar.holidays);
  if (dueDate > calendar.throughOn) return { releaseOn: null, eligibleAt: null, dueOn: null };
  return {
    releaseOn,
    eligibleAt: releaseOn <= evaluatedOn ? workspaceDayRange(releaseOn, input.timeZone).start : null,
    dueOn: new Date(dueDate),
  };
}
