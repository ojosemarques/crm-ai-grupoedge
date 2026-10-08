import { describe, expect, it, vi } from "vitest";

import {
  chooseProspectingSeller,
  createProspectingPlannerService,
} from "@/modules/prospecting/application/prospecting-planner-service";

const sellers = [
  { memberId: "carlos", dailyCapacity: 75, reservePercent: 0, rotationPosition: 0 },
  { memberId: "jhon", dailyCapacity: 75, reservePercent: 0, rotationPosition: 1 },
  { memberId: "ede", dailyCapacity: 75, reservePercent: 0, rotationPosition: 2 },
] as const;
const dates = ["2026-10-05", "2026-10-12", "2026-10-23"];

describe("planejador de capacidade da Prospecção Ativa", () => {
  it("não descobre vendedores por nome durante a fundação", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "settings", dailyCapacity: 75, reservePercent: 10 });
    const findMany = vi.fn();
    const database = {
      prospectingSettings: { upsert },
      prospectingSellerConfig: { findMany },
    };
    const service = createProspectingPlannerService({
      database: database as never,
      now: () => new Date("2026-10-05T12:00:00.000Z"),
    });

    await expect(service.ensureFoundation(database as never, "workspace-id", "actor-id"))
      .resolves.toMatchObject({ id: "settings" });
    expect(upsert).toHaveBeenCalledOnce();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("escolhe menor carga e usa a rotação como desempate determinístico", () => {
    const loads = new Map<string, number>([
      ["carlos:2026-10-05", 10],
      ["jhon:2026-10-05", 5],
      ["ede:2026-10-05", 5],
    ]);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBe("jhon");
  });

  it("considera somente a fila do dia atual e não bloqueia novos por uma data futura", () => {
    const loads = new Map<string, number>([
      ["carlos:2026-10-12", 75],
      ["jhon:2026-10-05", 75],
      ["ede:2026-10-05", 74],
    ]);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBe("carlos");
    loads.set("carlos:2026-10-05", 75);
    loads.set("ede:2026-10-05", 75);
    expect(chooseProspectingSeller({ sellers, dates, loads })).toBeNull();
  });

  it("usa a meta configurada integral de 75 políticos sem descontar a reserva legada", () => {
    const withReserve = [{ memberId: "carlos", dailyCapacity: 75, reservePercent: 10, rotationPosition: 0 }];
    const loads = new Map<string, number>([["carlos:2026-10-05", 74]]);
    expect(chooseProspectingSeller({ sellers: withReserve, dates, loads })).toBe("carlos");
    loads.set("carlos:2026-10-05", 75);
    expect(chooseProspectingSeller({ sellers: withReserve, dates, loads })).toBeNull();
  });
});
