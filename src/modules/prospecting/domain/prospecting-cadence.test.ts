import { describe, expect, it } from "vitest";

import {
  manualCapacityDates,
  PROSPECTING_CADENCE,
  scheduleProspectingCadence,
} from "@/modules/prospecting/domain/prospecting-cadence";

describe("cadência de prospecção política", () => {
  it("materializa 16 contatos e o encerramento, incluindo três passos distintos no D1", () => {
    const schedule = scheduleProspectingCadence({ d1Date: "2026-10-05", timeZone: "America/Sao_Paulo", holidays: new Set() });
    expect(schedule).toHaveLength(17);
    expect(schedule.filter((step) => step.dayNumber === 1).map((step) => step.stepKey)).toEqual(["call-1", "instagram-message-1", "instagram-follow"]);
    expect(new Set(PROSPECTING_CADENCE.map((step) => step.stepKey)).size).toBe(17);
  });

  it("empurra sábado, domingo e feriado para o próximo dia útil", () => {
    const schedule = scheduleProspectingCadence({ d1Date: "2026-10-05", timeZone: "America/Sao_Paulo", holidays: new Set(["2026-10-12"]) });
    expect(schedule.find((step) => step.stepKey === "instagram-message-2")?.localDate).toBe("2026-10-13");
  });

  it("mantém colisões no mesmo dia para capacidade distinct por Lead", () => {
    const dates = manualCapacityDates({ d1Date: "2026-10-05", holidays: new Set(["2026-10-12"]) });
    expect(dates.length).toBeLessThan(PROSPECTING_CADENCE.filter((step) => step.executor === "SELLER").length);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("não agenda ajuste para depois do D30", () => {
    const schedule = scheduleProspectingCadence({ d1Date: "2026-10-05", timeZone: "America/Sao_Paulo", holidays: new Set(["2026-11-03"]) });
    const close = schedule.find((step) => step.stepKey === "close-no-response")!;
    expect(close.localDate <= "2026-11-03").toBe(true);
    expect(close.localDate).toBe("2026-11-02");
  });
});
