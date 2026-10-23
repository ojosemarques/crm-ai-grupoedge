import { describe, expect, it } from "vitest";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods } from "./realtime-dashboard-domain";
import type { RealtimeDailyProfile, RealtimeWeeklyQuota } from "./realtime-dashboard-goals";

const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-22T15:00:00Z"), "America/Sao_Paulo");
const sellers = [{ id: "a", name: "Mesmo nome", functions: ["CLOSER"], teamIds: ["team"] }, { id: "b", name: "Mesmo nome", functions: ["CLOSER"], teamIds: ["team"] }];
const profile = (memberId: string, callsTarget = 10): RealtimeDailyProfile => ({ memberId, callsTarget, messagesTarget: 5, effectiveContactsTarget: 2, meetingsScheduledTarget: 1, salesValueTargetCents: 10000n });
const fact = (input: Partial<IntegratedActivityFact> & Pick<IntegratedActivityFact, "id" | "eventType">): IntegratedActivityFact => ({ sourceEntityType: "Task", leadId: "lead", creditedMemberId: "a", performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, quantity: 1, valueCents: null, occurredAt: "2026-10-22T14:00:00Z", ...input });
const quota = (input: Partial<RealtimeWeeklyQuota> = {}): RealtimeWeeklyQuota => ({ targetType: "FUNCTION", function: "CLOSER", memberId: null, teamId: null, metricKey: "OPPORTUNITIES_WON", targetValue: 10n, ...input });

describe("metas reais do painel unificado", () => {
  it("isola vendedores homônimos por ID sem publicar IDs", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "a", eventType: "CALL_ATTEMPTED", quantity: 3 }), fact({ id: "b", eventType: "CALL_ATTEMPTED", creditedMemberId: "b", quantity: 7 })], sellers, periods, { profiles: [profile("a", 10), profile("b", 20)], quotas: [] });
    expect(result.week.ranking.map((row) => [row.today.calls, row.goals.today.calls.targetValue])).toEqual([[3, "10"], [7, "20"]]);
    expect(result.today.goals.calls).toMatchObject({ actualValue: "10", targetValue: "30", coveredMembers: 2 });
    expect(result.week.goals.calls).toMatchObject({ actualValue: "10", targetValue: "150", source: "DAILY_PROFILE_X5" });
    expect(JSON.stringify(result)).not.toContain('"memberId"');
  });

  it("não inclui e-mails no total de mensagens nem na meta WA/IG da TV", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "wa", eventType: "WHATSAPP_MESSAGE_SENT", quantity: 2 }), fact({ id: "email", eventType: "EMAIL_SENT", quantity: 8 })], sellers, periods, { profiles: [profile("a")], quotas: [] });
    expect(result.today.totals.messages).toBe(2);
    expect(result.today.goals.messages).toMatchObject({ actualValue: "2", targetValue: "5", progressBasisPoints: 4000, coveredMembers: 1, totalMembers: 2 });
  });

  it("deduplica contatos entre vendedores no consolidado e acumula contatos-dia para a meta semanal", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "mon", eventType: "CALL_CONNECTED", occurredAt: "2026-10-19T14:00:00Z" }), fact({ id: "today", eventType: "CALL_CONNECTED" }), fact({ id: "other", eventType: "CALL_CONNECTED", creditedMemberId: "b" })], sellers, periods, { profiles: [profile("a"), profile("b")], quotas: [] });
    expect(result.week.totals.effectiveContacts).toBe(1);
    expect(result.week.goals.effectiveContacts).toMatchObject({ actualValue: "2", targetValue: "20" });
    expect(result.today.goals.effectiveContacts.actualValue).toBe("1");
    expect(result.week.ranking.map(row => row.goals.today.effectiveContacts.actualValue)).toEqual(["1", "1"]);
  });

  it("não duplica quota coletiva com quota individual e não divide a coletiva artificialmente", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "sale-a", eventType: "SALE_WON", quantity: 2 }), fact({ id: "sale-b", eventType: "SALE_WON", quantity: 3, creditedMemberId: "b" })], sellers, periods, { profiles: [], quotas: [quota({ targetType: "MEMBER", memberId: "a", function: null, targetValue: 4n }), quota()], planName: "Semana comercial" });
    expect(result.week.goals.sales).toMatchObject({ actualValue: "5", targetValue: "10", progressBasisPoints: 5000 });
    const own = result.week.ranking.find((row) => row.sales === 2)!;
    expect(own.goals.week.sales).toMatchObject({ actualValue: "2", targetValue: "4" });
    expect(result.week.ranking.find((row) => row.sales === 3)!.goals.week.sales.targetValue).toBeNull();
  });

  it("separa execução de atividade e preserva fatos sem atribuição nos totais gerais", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "task", eventType: "TASK_COMPLETED" }), fact({ id: "call", eventType: "CALL_ATTEMPTED" }), fact({ id: "unattributed", eventType: "CALL_ATTEMPTED", creditedMemberId: null, quantity: 2 })], sellers, periods);
    expect(result.today.totals).toMatchObject({ calls: 3, tasksCompleted: 1 });
    expect(result.week.ranking[0]).toMatchObject({ calls: 1, actions: 1, tasksCompleted: 1 });
  });

  it("não dá 100% a metas zero, ausentes ou a vendedores inativos", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "call", eventType: "CALL_ATTEMPTED", quantity: 10 })], [{ ...sellers[0]!, active: false }, sellers[1]!], periods, { profiles: [profile("a"), profile("b", 0)], quotas: [quota({ targetValue: 0n })] });
    expect(result.today.goals.calls).toMatchObject({ targetValue: null, progressBasisPoints: null, coveredMembers: 0, totalMembers: 0 });
    expect(result.week.goals.sales.progressBasisPoints).toBeNull();
  });

  it("usa os perfis recorrentes do Meu Dia para os três vendedores, com reuniões e vendas restritas a Jhon e Ede", () => {
    const roster = [
      { id: "carlos", name: "Carlos", functions: ["SDR"] },
      { id: "jhon", name: "Jhon", functions: ["CLOSER"] },
      { id: "ede", name: "Ede", functions: ["CLOSER"] },
      { id: "admin", name: "Admin", functions: ["CLOSER"] },
    ];
    const profiles = roster.map((member) => ({ ...profile(member.id, member.id === "carlos" ? 60 : 50), effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: ["jhon", "ede"].includes(member.id) ? 2 : 0, weeklySalesTarget: ["jhon", "ede"].includes(member.id) ? 1 : 0 }));
    const configuration = { profiles, quotas: [quota({ targetValue: 99n })], eligibleMemberIds: ["carlos", "jhon", "ede"] };
    const result = aggregateRealtimeDashboard([
      fact({ id: "held", eventType: "MEETING_COMPLETED", creditedMemberId: "jhon", quantity: 2 }),
      fact({ id: "sale", eventType: "SALE_WON", creditedMemberId: "ede" }),
    ], roster, periods, configuration);
    expect(result.today.goals.effectiveContacts).toMatchObject({ targetValue: "225", coveredMembers: 3, totalMembers: 3 });
    expect(result.today.goals.meetingsScheduled.targetValue).toBe("12");
    expect(result.today.goals.meetingsCompleted).toMatchObject({ targetValue: "4", actualValue: "2", coveredMembers: 2, totalMembers: 2 });
    expect(result.week.goals.effectiveContacts.targetValue).toBe("1125");
    expect(result.week.goals.meetingsScheduled.targetValue).toBe("60");
    expect(result.week.goals.meetingsCompleted.targetValue).toBe("20");
    expect(result.week.goals.sales).toMatchObject({ targetValue: "2", actualValue: "1", source: "WEEKLY_PROFILE", coveredMembers: 2, totalMembers: 2 });
    for (const row of result.week.ranking.filter((row) => row.name !== "Admin")) {
      expect(row.goals.today.effectiveContacts.targetValue).toBe("75");
      expect(row.goals.today.meetingsScheduled.targetValue).toBe("4");
      expect(row.goals.week.effectiveContacts.targetValue).toBe("375");
      expect(row.goals.week.meetingsScheduled.targetValue).toBe("20");
      expect(row.goals.today.meetingsCompleted.targetValue).toBe(row.name === "Carlos" ? null : "2");
      expect(row.goals.week.meetingsCompleted.targetValue).toBe(row.name === "Carlos" ? null : "10");
      expect(row.goals.today.sales.targetValue).toBeNull();
      expect(row.goals.week.sales.targetValue).toBe(row.name === "Carlos" ? null : "1");
    }
    expect(result.week.ranking.find(row => row.name === "Carlos")!.goals.today.calls.targetValue).toBe("60");
    const nextWeek = aggregateRealtimeDashboard([], roster, resolveRealtimeDashboardPeriods(new Date("2026-10-26T15:00:00Z"), "America/Sao_Paulo"), configuration);
    expect(nextWeek.week.goals.sales).toMatchObject({ actualValue: "0", targetValue: "2", source: "WEEKLY_PROFILE" });
  });

  it("zero explícito desativa a cobrança mesmo com quota antiga, enquanto ausência mantém compatibilidade", () => {
    const configuration = { profiles: [{ ...profile("a"), meetingsCompletedTarget: 0, weeklySalesTarget: 0 }], quotas: [quota({ targetType: "MEMBER", memberId: "a" }), quota({ targetType: "MEMBER", memberId: "a", metricKey: "MEETINGS_HELD" })] };
    const disabled = aggregateRealtimeDashboard([], [sellers[0]!], periods, configuration);
    expect(disabled.week.goals.sales.targetValue).toBeNull();
    expect(disabled.week.goals.meetingsCompleted.targetValue).toBeNull();
    const legacy = aggregateRealtimeDashboard([], [sellers[0]!], periods, { ...configuration, profiles: [{ ...profile("a"), meetingsCompletedTarget: null, weeklySalesTarget: null }] });
    expect(legacy.week.goals.sales.targetValue).toBe("10");
    expect(legacy.week.goals.meetingsCompleted.targetValue).toBe("10");
  });
});
