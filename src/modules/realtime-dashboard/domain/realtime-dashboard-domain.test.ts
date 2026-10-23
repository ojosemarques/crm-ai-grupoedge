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
    expect(summary.today.totals).toMatchObject({ calls: 1, messages: 1, effectiveContacts: 1, sales: 1, salesValueCents: "250000" });
    expect(summary.week.totals).toEqual(summary.today.totals);
  });

  it("conta somente WhatsApp e Instagram em totais, ranking e gráfico sem excluir contatos por e-mail", () => {
    const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-22T15:00:00Z"), "America/Sao_Paulo");
    const facts = [
      fact({ id: "wa", eventType: "WHATSAPP_MESSAGE_SENT", occurredAt: "2026-10-22T12:00:00Z", creditedMemberId: "a", leadId: "lead-wa", quantity: 4 }),
      fact({ id: "ig", eventType: "INSTAGRAM_MESSAGE_SENT", occurredAt: "2026-10-22T12:01:00Z", creditedMemberId: "a", leadId: "lead-ig", quantity: 3 }),
      fact({ id: "ig-correction", eventType: "INSTAGRAM_MESSAGE_SENT", occurredAt: "2026-10-22T12:01:00Z", creditedMemberId: "a", leadId: "lead-ig", quantity: -1 }),
      fact({ id: "email", eventType: "EMAIL_SENT", occurredAt: "2026-10-22T12:02:00Z", creditedMemberId: "a", leadId: "lead-email", quantity: 100 }),
      fact({ id: "old-wa", eventType: "WHATSAPP_MESSAGE_SENT", occurredAt: "2026-10-20T12:00:00Z", creditedMemberId: "a", leadId: "lead-wa", quantity: 2 }),
      fact({ id: "old-email", eventType: "EMAIL_SENT", occurredAt: "2026-10-20T12:00:00Z", creditedMemberId: "a", leadId: "lead-email", quantity: 50 }),
      fact({ id: "unattributed", eventType: "INSTAGRAM_MESSAGE_SENT", occurredAt: "2026-10-22T12:03:00Z", quantity: 1 }),
    ];
    const summary = aggregateRealtimeDashboard(facts, [{ id: "a", name: "Ana Lima" }], periods);
    expect(summary.today.totals.messages).toBe(7);
    expect(summary.week.totals.messages).toBe(9);
    expect(summary.week.ranking[0]).toMatchObject({ messages: 8, today: { messages: 6 } });
    expect(summary.week.daily.map(day => day.totals.messages)).toEqual([0, 2, 0, 7, 0]);
    expect(summary.today.totals.effectiveContacts).toBe(3);
  });

  it("prioriza agendamentos no período em vez de ações e mantém vendedores com zero", () => {
    const facts = [
      fact({ id: "a1", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T12:00:00.000Z", creditedMemberId: "a", quantity: 100 }),
      fact({ id: "b1", eventType: "MEETING_COMPLETED", occurredAt: "2026-10-22T12:00:00.000Z", creditedMemberId: "b" }),
      fact({ id: "b2", eventType: "SALE_WON", occurredAt: "2026-10-22T12:01:00.000Z", creditedMemberId: "b" }),
      fact({ id: "b3", eventType: "MEETING_SCHEDULED", occurredAt: "2026-10-22T12:02:00.000Z", creditedMemberId: "a", bookedByMemberId: "b" }),
    ];
    const ranking = buildRealtimeDashboardRanking(facts, [
      { id: "a", name: "Ana Lima" },
      { id: "b", name: "Bia Luz" },
      { id: "c", name: "Carlos Sol" },
    ]);

    expect(ranking.map((row) => [row.name, row.actions, row.position])).toEqual([
      ["Bia Luz", 2, 1],
      ["Ana Lima", 100, 2],
      ["Carlos Sol", 0, 3],
    ]);
  });

  it("ordena pódio e tabela por agendamentos de hoje, com desempate semanal e nominal, sem trocar metas entre pessoas", () => {
    const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-22T15:00:00Z"), "America/Sao_Paulo");
    const sellers = [{ id: "c", name: "Carlos" }, { id: "e", name: "Ede" }, { id: "j", name: "Jhon" }];
    const profiles = sellers.map((seller, index) => ({ memberId: seller.id, callsTarget: 50 + index, messagesTarget: 40, effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: seller.id === "c" ? 0 : 2, salesValueTargetCents: 0n }));
    const facts = [
      fact({ id: "c-old", eventType: "MEETING_SCHEDULED", creditedMemberId: "c", quantity: 10, occurredAt: "2026-10-20T12:00:00Z" }),
      fact({ id: "c-calls", eventType: "CALL_ATTEMPTED", creditedMemberId: "c", quantity: 100, occurredAt: "2026-10-22T12:00:00Z" }),
      fact({ id: "e-today", eventType: "MEETING_SCHEDULED", creditedMemberId: "c", bookedByMemberId: "e", quantity: 3, occurredAt: "2026-10-22T12:00:00Z" }),
      fact({ id: "j-today", eventType: "MEETING_SCHEDULED", creditedMemberId: "j", quantity: 2, occurredAt: "2026-10-22T12:00:00Z" }),
    ];
    const summary = aggregateRealtimeDashboard(facts, sellers, periods, { profiles, quotas: [] });
    expect(summary.week.ranking.map(row => [row.position, row.name, row.today.meetingsScheduled, row.meetingsScheduled, row.goals.today.calls.targetValue])).toEqual([
      [1, "Ede", 3, 3, "51"], [2, "Jhon", 2, 2, "52"], [3, "Carlos", 0, 10, "50"],
    ]);
    const tied = aggregateRealtimeDashboard([], sellers, periods, { profiles, quotas: [] });
    expect(tied.week.ranking.map(row => row.name)).toEqual(["Carlos", "Ede", "Jhon"]);
    const weeklyTie = aggregateRealtimeDashboard(facts.filter(row => row.id !== "e-today" && row.id !== "j-today"), sellers, periods, { profiles, quotas: [] });
    expect(weeklyTie.week.ranking.map(row => row.name)).toEqual(["Carlos", "Ede", "Jhon"]);
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
      ["Carlos Henrique", 1, 1], ["Ede Rafael", 2, 2], ["Jhon Cunha", 3, 3],
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
