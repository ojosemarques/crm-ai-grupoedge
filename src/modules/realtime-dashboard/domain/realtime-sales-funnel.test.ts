import { describe, expect, it } from "vitest";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods } from "./realtime-dashboard-domain";

const periods = resolveRealtimeDashboardPeriods(new Date("2026-10-23T18:00:00Z"), "America/Sao_Paulo");
const fact = (id: string, leadId: string | null, eventType: string, quantity = 1): IntegratedActivityFact => ({
  id, leadId, eventType, quantity, sourceEntityType: "Activity", creditedMemberId: "seller",
  performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null,
  valueCents: null, occurredAt: "2026-10-23T14:00:00Z",
});
const aggregate = (facts: readonly IntegratedActivityFact[]) => aggregateRealtimeDashboard(facts, [{ id: "seller", name: "Vendedor" }], periods);

describe("funil comercial semanal da TV", () => {
  it("deduplica leads trabalhados e calcula cada taxa sobre a etapa anterior", () => {
    const leads = Array.from({ length: 100 }, (_, i) => fact(`call-${i}`, `lead-${i}`, "CALL_ATTEMPTED"));
    const result = aggregate([
      ...leads, fact("repeated", "lead-0", "WHATSAPP_MESSAGE_SENT"),
      fact("scheduled", "lead-0", "MEETING_SCHEDULED", 30),
      fact("completed", "lead-0", "MEETING_COMPLETED", 10),
      { ...fact("sale", "lead-0", "SALE_WON", 2), valueCents: "1800001" },
      { ...fact("old", "old-lead", "CALL_ATTEMPTED"), occurredAt: "2026-10-18T14:00:00Z" },
      { ...fact("future", "future-lead", "CALL_ATTEMPTED"), occurredAt: periods.week.to },
    ]);
    expect(result.week.funnel).toEqual({
      leadsWorked: 100, meetingsScheduled: 30, meetingsCompleted: 10, sales: 2, salesValueCents: "1800001",
      scheduledRateBasisPoints: 3000, completedRateBasisPoints: 3333, salesRateBasisPoints: 2000,
    });
    expect(result.week.funnel.meetingsScheduled).toBe(result.week.totals.meetingsScheduled);
    expect(result.week.funnel.salesValueCents).toBe(result.week.totals.salesValueCents);
  });

  it("considera trabalho sem resposta, e-mail e vendedor não atribuído, sem incluir cadastros ou fatos estornados", () => {
    const result = aggregate([
      fact("call", "lead-1", "CALL_ATTEMPTED"),
      { ...fact("another-seller", "lead-1", "TASK_COMPLETED"), creditedMemberId: "other" },
      { ...fact("email", "lead-2", "EMAIL_SENT"), creditedMemberId: null },
      fact("created", "new-only", "LEAD_CREATED"),
      fact("reversed", "removed", "WHATSAPP_MESSAGE_SENT"),
      fact("reversal", "removed", "WHATSAPP_MESSAGE_SENT", -1),
      fact("missing-lead", null, "CALL_ATTEMPTED"),
    ]);
    expect(result.week.funnel.leadsWorked).toBe(2);
    expect(result.week.totals.messages).toBe(0);
  });

  it("não inventa porcentagem sem denominador e não limita taxas do período a 100%", () => {
    expect(aggregate([]).week.funnel).toMatchObject({
      leadsWorked: 0, scheduledRateBasisPoints: null, completedRateBasisPoints: null, salesRateBasisPoints: null,
    });
    const result = aggregate([fact("scheduled", "lead", "MEETING_SCHEDULED"), fact("completed", "lead", "MEETING_COMPLETED", 2)]);
    expect(result.week.funnel.completedRateBasisPoints).toBe(20000);
  });
});
