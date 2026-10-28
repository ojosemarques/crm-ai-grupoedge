import { describe, expect, it } from "vitest";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods } from "./realtime-dashboard-domain";
import type { RealtimeActivityFact } from "./realtime-advertising-metrics";
import type { RealtimeSeller } from "./realtime-dashboard-goals";

const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-28T18:00:00Z"), "America/Sao_Paulo");
const sellers: RealtimeSeller[] = [{ id: "c", name: "Carlos", advertisingRole: "BOOKER" }, { id: "j", name: "Jhon", advertisingRole: "CLOSER" }, { id: "e", name: "Ede", advertisingRole: "CLOSER" }];
const configuration = { front: "ADVERTISING" as const, profiles: sellers.map(s => ({ memberId: s.id, callsTarget: 60, messagesTarget: 40, effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: 2, weeklySalesTarget: s.id === "c" ? 0 : 1, salesValueTargetCents: 0n })), quotas: [] };
const fact = (id: string, eventType: string, memberId: string | null = "c", quantity = 1, occurredAt = "2026-10-28T14:00:00Z"): RealtimeActivityFact => ({ id, eventType, creditedMemberId: memberId, quantity, occurredAt, sourceEntityType: "Activity", leadId: id, performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, valueCents: null });
const arrivals = (count: number) => Array.from({ length: count }, (_, index) => fact(`lead-${index}`, "LEAD_CREATED"));

describe("metas automáticas de anúncios", () => {
  it("calcula 50% das entradas para Carlos e 60% das reuniões atribuídas a cada closer", () => {
    const result = aggregateRealtimeDashboard([...arrivals(30), { ...fact("book-j", "MEETING_SCHEDULED", "c", 10), meetingOwnerMemberIdAtEvent: "j" }, { ...fact("book-e", "MEETING_SCHEDULED", "c", 5), meetingOwnerMemberIdAtEvent: "e" }, fact("held-j", "MEETING_COMPLETED", "j", 6), fact("held-e", "MEETING_COMPLETED", "e", 2)], sellers, periods, configuration);
    const row = (name: string) => result.week.ranking.find(row => row.name === name)!;
    expect(result.today.leadsReceived).toBe(30);
    expect(row("Carlos").goals.today.meetingsScheduled).toMatchObject({ targetValue: "15", actualValue: "15", source: "ADVERTISING_ARRIVALS" });
    expect(row("Carlos").goals.today.effectiveContacts.targetValue).toBe("30");
    expect(row("Carlos").goals.today.calls.targetValue).toBe("60");
    expect(row("Carlos").goals.today.messages.targetValue).toBe("40");
    expect(row("Jhon").goals.today.meetingsCompleted).toMatchObject({ targetValue: "6", actualValue: "6", source: "ADVERTISING_BOOKINGS" });
    expect(row("Ede").goals.today.meetingsCompleted).toMatchObject({ targetValue: "3", actualValue: "2" });
    for (const name of ["Jhon", "Ede"]) expect(row(name).goals.today.meetingsScheduled.targetValue).toBeNull();
    expect(row("Carlos").goals.today.meetingsCompleted.targetValue).toBeNull();
    expect(result.today.goals.meetingsScheduled.targetValue).toBe("15");
    expect(result.today.goals.meetingsCompleted.targetValue).toBe("9");
    expect(result.week.goals.sales.targetValue).toBe("2");
  });
  it("recalcula sem multiplicar por cinco, arredonda para cima e não inventa progresso sem base", () => {
    const first = aggregateRealtimeDashboard(arrivals(3), sellers, periods, configuration);
    expect(first.today.goals.meetingsScheduled.targetValue).toBe("2");
    expect(first.week.goals.meetingsScheduled.targetValue).toBe("2");
    const next = aggregateRealtimeDashboard([...arrivals(5), { ...fact("old", "LEAD_CREATED"), occurredAt: "2026-10-26T14:00:00Z" }], sellers, periods, configuration);
    expect(next.today.goals.meetingsScheduled.targetValue).toBe("3");
    expect(next.week.goals.meetingsScheduled.targetValue).toBe("3");
    const empty = aggregateRealtimeDashboard([], sellers, periods, configuration);
    expect(empty.today.goals.meetingsScheduled).toMatchObject({ targetValue: "0", progressBasisPoints: null });
    expect(empty.week.ranking.find(row => row.name === "Jhon")!.goals.today.meetingsCompleted).toMatchObject({ targetValue: "0", progressBasisPoints: null });
  });
  it("limita contatos, ligações e mensagens à entrada do período e mantém reuniões e vendas do período", () => {
    const facts = [...arrivals(1), { ...fact("old-lead", "LEAD_CREATED"), occurredAt: "2026-10-26T14:00:00Z" }, { ...fact("new-message", "WHATSAPP_MESSAGE_SENT", "c", 3), leadId: "lead-0" }, { ...fact("old-message", "WHATSAPP_MESSAGE_SENT", "c", 7), leadId: "old-lead" }, fact("meeting", "MEETING_COMPLETED", "j"), fact("sale", "SALE_WON", "e")];
    const result = aggregateRealtimeDashboard(facts, sellers, periods, configuration);
    expect(result.today.totals).toMatchObject({ effectiveContacts: 1, messages: 3, meetingsCompleted: 1, sales: 1 });
    expect(result.week.totals).toMatchObject({ effectiveContacts: 2, messages: 10 });
    expect(result.week.goals.effectiveContacts.actualValue).toBe("2");
    expect(result.week.funnel.scheduledRateBasisPoints).toBe(0);
  });
  it("não considera uma mensagem recebida como contato feito pelo pré-vendedor", () => {
    const result = aggregateRealtimeDashboard([...arrivals(1), { ...fact("inbound", "INBOUND_MESSAGE_RECEIVED"), leadId: "lead-0" }], sellers, periods, configuration);
    expect(result.today.totals.effectiveContacts).toBe(0);
    expect(result.today.goals.effectiveContacts).toMatchObject({ actualValue: "0", targetValue: "1" });
  });
});
