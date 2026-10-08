import { describe, expect, it } from "vitest";

import {
  manualCapacityDates,
  PROSPECTING_CADENCE,
  resolveProspectingManualResultReason,
  scheduleProspectingCadence,
} from "@/modules/prospecting/domain/prospecting-cadence";

describe("cadência de prospecção política", () => {
  it("materializa seis e-mails e o restante da cadência, incluindo três passos manuais no D1", () => {
    const schedule = scheduleProspectingCadence({ d1Date: "2026-10-05", timeZone: "America/Sao_Paulo", holidays: new Set() });
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((step) => ["call-1", "instagram-message-1", "instagram-follow"].includes(step.stepKey)).map((step) => step.dayNumber)).toEqual([1, 1, 1]);
    expect(schedule.filter((step) => step.executor === "OPEN_DOT").map((step) => [step.stepKey, step.dayNumber - 1])).toEqual([
      ["email-1", 0],
      ["email-2", 3],
      ["email-3", 7],
      ["email-4", 12],
      ["email-5", 18],
      ["email-6", 25],
    ]);
    expect(new Set(PROSPECTING_CADENCE.map((step) => step.stepKey)).size).toBe(16);
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

  it("registra motivo automático para resultados de exceção sem exigir texto adicional", () => {
    expect(resolveProspectingManualResultReason("WRONG_NUMBER")).toBe("Número incorreto informado pelo vendedor.");
    expect(resolveProspectingManualResultReason("CHANNEL_UNAVAILABLE")).toBe("Canal indisponível informado pelo vendedor.");
    expect(resolveProspectingManualResultReason("FAILED")).toBe("Falha informada pelo vendedor.");
    expect(resolveProspectingManualResultReason("PROFILE_NOT_FOUND")).toBe("Perfil não encontrado informado pelo vendedor.");
    expect(resolveProspectingManualResultReason("WRONG_NUMBER", "Telefone pertence a outra pessoa.")).toBe("Telefone pertence a outra pessoa.");
    expect(resolveProspectingManualResultReason("NO_ANSWER")).toBeNull();
  });
});
