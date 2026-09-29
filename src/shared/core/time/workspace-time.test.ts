import { describe, expect, it } from "vitest";

import {
  addWorkspaceCalendarDays,
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
  workspaceDayRange,
  workspaceWeekRange,
} from "@/shared/core/time/workspace-time";

describe("datas do workspace", () => {
  it("converte horário local de São Paulo para um instante UTC", () => {
    expect(parseWorkspaceLocalDateTime("2035-02-10T09:30", "America/Sao_Paulo").toISOString())
      .toBe("2035-02-10T12:30:00.000Z");
  });

  it("mantém o dia local perto da virada em UTC", () => {
    expect(workspaceDateAt(new Date("2035-02-11T01:30:00.000Z"), "America/Sao_Paulo"))
      .toBe("2035-02-10");
  });

  it("calcula dia e semana de segunda a domingo no fuso", () => {
    const day = workspaceDayRange("2035-02-10", "America/Sao_Paulo");
    expect(day.start.toISOString()).toBe("2035-02-10T03:00:00.000Z");
    expect(day.end.toISOString()).toBe("2035-02-11T03:00:00.000Z");
    const week = workspaceWeekRange("2035-02-10", "America/Sao_Paulo");
    expect(week.startDate).toBe("2035-02-05");
    expect(week.endDate).toBe("2035-02-11");
  });

  it("adiciona dias civis preservando o horário local durante mudança de offset", () => {
    const beforeDst = new Date("2026-03-07T14:00:00.000Z");
    expect(addWorkspaceCalendarDays(beforeDst, 1, "America/New_York").toISOString())
      .toBe("2026-03-08T13:00:00.000Z");
  });
});
