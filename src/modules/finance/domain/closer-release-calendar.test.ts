import { describe, expect, it } from "vitest";
import { firstDateOfNextMonth, resolveCloserReleaseDates } from "./closer-release-calendar";

const calendar = { throughOn: "2027-03-31", holidays: new Set(["2026-12-01", "2027-02-08"]) };
const timeZone = "America/Sao_Paulo";

describe("calendário de liberação de closers", () => {
  it("fecha novembro na virada local e vence no quinto dia útil de dezembro", () => {
    const milestoneOn = firstDateOfNextMonth("2026-11");
    expect(resolveCloserReleaseDates({ cycle: "MONTHLY", milestoneOn, evaluatedOn: "2026-12-01", timeZone, calendar })).toEqual({
      releaseOn: "2026-12-01", eligibleAt: new Date("2026-12-01T03:00:00Z"), dueOn: new Date("2026-12-08"),
    });
  });

  it("respeita o primeiro dia útil do marco e mantém a data da regularização tardia em replay", () => {
    const facts = { cycle: "INSTALLMENT" as const, milestoneOn: "2027-02-08", timeZone, calendar };
    expect(resolveCloserReleaseDates({ ...facts, evaluatedOn: "2027-02-08" })).toEqual({
      releaseOn: "2027-02-09", eligibleAt: null, dueOn: new Date("2027-03-05"),
    });
    const regularized = resolveCloserReleaseDates({ ...facts, evaluatedOn: "2027-02-12" });
    expect(regularized).toEqual({ releaseOn: "2027-02-15", eligibleAt: null, dueOn: new Date("2027-03-05") });
    expect(resolveCloserReleaseDates({ ...facts, evaluatedOn: "2027-02-17", previousReleaseOn: "2027-02-15" })).toEqual({
      ...regularized, eligibleAt: new Date("2027-02-15T03:00:00Z"),
    });
  });

  it("retém a liberação quando o calendário não comprova o vencimento", () => {
    expect(resolveCloserReleaseDates({
      cycle: "MONTHLY", milestoneOn: "2026-12-01", evaluatedOn: "2026-12-01", timeZone,
      calendar: { ...calendar, throughOn: "2026-12-07" },
    })).toEqual({ releaseOn: null, eligibleAt: null, dueOn: null });
  });
});
