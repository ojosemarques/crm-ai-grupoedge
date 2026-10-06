import { describe, expect, it } from "vitest";

import { chooseProspectingSeller } from "@/modules/prospecting/application/prospecting-planner-service";

const sellers = [
  { memberId: "carlos", dailyCapacity: 75, reservePercent: 0, rotationPosition: 0 },
  { memberId: "jhon", dailyCapacity: 75, reservePercent: 0, rotationPosition: 1 },
  { memberId: "ede", dailyCapacity: 75, reservePercent: 0, rotationPosition: 2 },
] as const;
const dates = ["2026-10-05", "2026-10-12", "2026-10-23"];

describe("planejador de capacidade da Prospecção Ativa", () => {
  it("escolhe menor carga e usa a rotação como desempate determinístico", () => {
    const loads = new Map<string, number>([
      ["carlos:2026-10-05", 10],
      ["jhon:2026-10-05", 5],
      ["ede:2026-10-05", 5],
    ]);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBe("jhon");
  });

  it("rejeita vendedor se qualquer dia futuro atingir a capacidade", () => {
    const loads = new Map<string, number>([
      ["carlos:2026-10-12", 75],
      ["jhon:2026-10-23", 75],
      ["ede:2026-10-05", 74],
    ]);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBe("ede");
    loads.set("ede:2026-10-05", 75);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBeNull();
  });

  it("aplica a reserva antes de aceitar nova liberação", () => {
    const withReserve = [{ memberId: "carlos", dailyCapacity: 75, reservePercent: 10, rotationPosition: 0 }];
    const loads = new Map<string, number>([["carlos:2026-10-05", 67]]);
    expect(chooseProspectingSeller({ sellers: withReserve, dates, loads })).toBeNull();
  });
});
