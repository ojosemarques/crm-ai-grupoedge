import { expect, it } from "vitest";
import { projectLegacyCompensation, type LegacyStageDay } from "./legacy-compensation";

it("separa três etapas, ajusta feriado e abate só a baixa comprovada", () => {
  const stages = projectLegacyCompensation({
    acvCents: 1_500_000n, d0On: "2026-10-01", holidays: new Set(["2026-11-02"]), verifiedThroughOn: "2026-12-31",
    possiblyPaidStages: new Set<LegacyStageDay>([30]), allocations: new Map<LegacyStageDay, bigint>([[30, 10_000n]]),
  });
  expect(stages.map(({ amountCents }) => amountCents)).toEqual([31500n, 27000n, 31500n]);
  expect(stages[0]).toMatchObject({
    milestoneOn: "2026-10-31", dueOn: "2026-11-03", paidCents: 10000n, balanceCents: 21500n,
    reason: expect.stringContaining("Pagamento informado"),
  });
  expect(stages[1]).toMatchObject({ dueOn: "2026-11-30", paidCents: 0n, reason: null });
});

it("não deduz valores teóricos quando há pagamento informado sem alocação", () => {
  const stages = projectLegacyCompensation({
    acvCents: 1_500_000n, d0On: null, holidays: new Set(), verifiedThroughOn: null,
    possiblyPaidStages: new Set<LegacyStageDay>([30, 60]), allocations: new Map(),
  });
  expect(stages.map(({ paidCents, dueOn }) => [paidCents, dueOn])).toEqual([[0n, null], [0n, null], [0n, null]]);
  expect(stages[2]?.reason).toContain("sem comprovação");
});
