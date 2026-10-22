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
    expect(result.week.ranking.map((row) => [row.today.calls, row.goals.today.calls.targetValue])).toEqual([[7, "20"], [3, "10"]]);
    expect(result.today.goals.calls).toMatchObject({ actualValue: "10", targetValue: "30", coveredMembers: 2 });
    expect(result.week.goals.calls).toMatchObject({ actualValue: "10", targetValue: "150", source: "DAILY_PROFILE_X5" });
    expect(JSON.stringify(result)).not.toContain('"memberId"');
  });

  it("não infla meta WA/IG com e-mails e mantém total de mensagens dos Indicadores", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "wa", eventType: "WHATSAPP_MESSAGE_SENT", quantity: 2 }), fact({ id: "email", eventType: "EMAIL_SENT", quantity: 8 })], sellers, periods, { profiles: [profile("a")], quotas: [] });
    expect(result.today.totals.messages).toBe(10);
    expect(result.today.goals.messages).toMatchObject({ actualValue: "2", targetValue: "5", progressBasisPoints: 4000, coveredMembers: 1, totalMembers: 2 });
  });

  it("mantém contato único no período e acumula contatos-dia individuais para metas recorrentes", () => {
    const result = aggregateRealtimeDashboard([fact({ id: "mon", eventType: "CALL_CONNECTED", occurredAt: "2026-10-19T14:00:00Z" }), fact({ id: "today", eventType: "CALL_CONNECTED" }), fact({ id: "other", eventType: "CALL_CONNECTED", creditedMemberId: "b" })], sellers, periods, { profiles: [profile("a"), profile("b")], quotas: [] });
    expect(result.week.totals.effectiveContacts).toBe(1);
    expect(result.week.goals.effectiveContacts).toMatchObject({ actualValue: "3", targetValue: "20" });
    expect(result.today.goals.effectiveContacts.actualValue).toBe("2");
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
    expect(result.today.goals.calls).toMatchObject({ targetValue: null, progressBasisPoints: null, coveredMembers: 0, totalMembers: 1 });
    expect(result.week.goals.sales.progressBasisPoints).toBeNull();
  });
});
