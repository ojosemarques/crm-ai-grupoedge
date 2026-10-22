import { describe, expect, it } from "vitest";

import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import {
  aggregateRealtimeDashboard,
  buildRealtimeDashboardRanking,
  resolveRealtimeDashboardPeriods,
  weeklySalesGoal,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";

function fact(input: Partial<IntegratedActivityFact> & Pick<IntegratedActivityFact, "id" | "eventType" | "occurredAt">): IntegratedActivityFact {
  return {
    sourceEntityType: "Activity",
    leadId: null,
    creditedMemberId: null,
    performedByMemberId: null,
    bookedByMemberId: null,
    taskKind: null,
    result: null,
    cadenceStepKey: null,
    quantity: 1,
    valueCents: null,
    ...input,
  };
}

describe("dashboard tempo real", () => {
  it("fecha a semana operacional no sábado e preserva hoje no fim de semana", () => {
    const periods = resolveRealtimeDashboardPeriods(
      new Date("2026-10-24T15:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(periods.week.from).toBe("2026-10-19T03:00:00.000Z");
    expect(periods.week.to).toBe("2026-10-24T03:00:00.000Z");
    expect(periods.week.toDate).toBe("2026-10-23");
    expect(periods.today.from).toBe("2026-10-24T03:00:00.000Z");
    expect(periods.today.to).toBe("2026-10-24T15:00:00.000Z");
  });

  it("usa intervalo semiaberto e soma fatos canônicos sem duplicar contato efetivo", () => {
    const periods = resolveRealtimeDashboardPeriods(
      new Date("2026-10-22T15:00:00.000Z"),
      "America/Sao_Paulo",
    );
    const facts = [
      fact({ id: "call", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T12:00:00.000Z", creditedMemberId: "a" }),
      fact({ id: "wa", eventType: "WHATSAPP_MESSAGE_SENT", occurredAt: "2026-10-22T12:01:00.000Z", creditedMemberId: "a", leadId: "lead-1" }),
      fact({ id: "mail", eventType: "EMAIL_SENT", occurredAt: "2026-10-22T12:02:00.000Z", creditedMemberId: "a", leadId: "lead-1" }),
      fact({ id: "sale", eventType: "SALE_WON", occurredAt: "2026-10-22T12:03:00.000Z", creditedMemberId: "b", valueCents: "250000" }),
      fact({ id: "future", eventType: "CALL_ATTEMPTED", occurredAt: periods.today.to, creditedMemberId: "b" }),
    ];

    const summary = aggregateRealtimeDashboard(facts, [{ id: "a", name: "Ana Lima" }, { id: "b", name: "Bia Luz" }], periods);
    expect(summary.today.totals).toMatchObject({ calls: 1, messages: 2, effectiveContacts: 1, sales: 1, salesValueCents: "250000" });
    expect(summary.week.totals).toEqual(summary.today.totals);
  });

  it("ordena ranking pelos critérios definidos e mantém vendedores com zero", () => {
    const facts = [
      fact({ id: "a1", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T12:00:00.000Z", creditedMemberId: "a" }),
      fact({ id: "b1", eventType: "MEETING_COMPLETED", occurredAt: "2026-10-22T12:00:00.000Z", creditedMemberId: "b" }),
      fact({ id: "b2", eventType: "SALE_WON", occurredAt: "2026-10-22T12:01:00.000Z", creditedMemberId: "b" }),
    ];
    const ranking = buildRealtimeDashboardRanking(facts, [
      { id: "a", name: "Ana Lima" },
      { id: "b", name: "Bia Luz" },
      { id: "c", name: "Carlos Sol" },
    ]);

    expect(ranking.map((row) => [row.name, row.actions, row.position])).toEqual([
      ["Bia Luz", 1, 1],
      ["Ana Lima", 1, 2],
      ["Carlos Sol", 0, 3],
    ]);
  });

  it("oculta membros somente do ranking, preservando fatos, totais e metas gerais", () => {
    const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-22T15:00:00Z"), "America/Sao_Paulo");
    const sellers = [
      { id: "carlos", name: "Carlos Henrique" },
      { id: "ede", name: "Ede Rafael" },
      { id: "jhon", name: "Jhon Cunha" },
      { id: "matheus", name: "Matheus Mendon" },
      { id: "admin", name: "Administrador" },
    ];
    const facts = sellers.map((seller, index) => fact({ id: seller.id, eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T12:00:00Z", creditedMemberId: seller.id, quantity: index + 1 }));
    const configuration = { profiles: sellers.map((seller) => ({ memberId: seller.id, callsTarget: 50, messagesTarget: 40, effectiveContactsTarget: 10, meetingsScheduledTarget: 3, salesValueTargetCents: 0n })), quotas: [] };
    const original = aggregateRealtimeDashboard(facts, sellers, periods, configuration);
    const filtered = aggregateRealtimeDashboard(facts, sellers.map((seller) => ({ ...seller, rankingVisible: ["carlos", "ede", "jhon"].includes(seller.id) })), periods, configuration);

    expect(filtered.today).toEqual(original.today);
    expect(filtered.week.totals).toEqual(original.week.totals);
    expect(filtered.week.goals).toEqual(original.week.goals);
    expect(filtered.week.daily).toEqual(original.week.daily);
    expect(filtered.week.ranking.map((row) => [row.name, row.position, row.calls])).toEqual([
      ["Jhon Cunha", 1, 3], ["Ede Rafael", 2, 2], ["Carlos Henrique", 3, 1],
    ]);
    for (const row of filtered.week.ranking) {
      expect(row.today.calls).toBe(row.calls);
      expect(row.goals.week.calls.targetValue).toBe("250");
    }
  });

  it("distribui fatos por dia local sem inventar valores futuros nem incluir o sábado", () => {
    const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-22T15:00:00Z"), "America/Sao_Paulo");
    const summary = aggregateRealtimeDashboard([
      fact({ id: "monday", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-20T02:59:00Z", creditedMemberId: "a" }),
      fact({ id: "tuesday", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-20T03:00:00Z", creditedMemberId: "a" }),
      fact({ id: "today", eventType: "WHATSAPP_MESSAGE_SENT", occurredAt: "2026-10-22T14:59:00Z", creditedMemberId: "a" }),
      fact({ id: "future", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-23T12:00:00Z", creditedMemberId: "a" }),
      fact({ id: "weekend", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-24T12:00:00Z", creditedMemberId: "a" }),
    ], [{ id: "a", name: "Ana Lima" }], periods);
    expect(summary.week.endsAt).toBe("2026-10-24T03:00:00.000Z");
    expect(summary.week.daily.map((day) => [day.date, day.totals.calls, day.totals.messages, day.future])).toEqual([
      ["2026-10-19", 1, 0, false], ["2026-10-20", 1, 0, false], ["2026-10-21", 0, 0, false], ["2026-10-22", 0, 1, false], ["2026-10-23", 0, 0, true],
    ]);
    expect(summary.week.daily.reduce((sum, day) => sum + day.totals.calls, 0)).toBe(summary.week.totals.calls);
  });

  it("distingue meta ausente, zero e progresso acima de 100%", () => {
    expect(weeklySalesGoal(3, null, null)).toMatchObject({ target: null, progressBasisPoints: null });
    expect(weeklySalesGoal(0, 0n, "Meta")).toMatchObject({ target: "0", progressBasisPoints: 0 });
    expect(weeklySalesGoal(6, 4n, "Meta")).toMatchObject({ target: "4", progressBasisPoints: 15_000 });
  });
});
