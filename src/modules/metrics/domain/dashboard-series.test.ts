import { describe, expect, it } from "vitest";
import type { DashboardTimeSeries } from "./dashboard-contracts";
import type { IntegratedActivityFact } from "./metrics-contracts";
import { mergeIntegratedActivitySeries } from "./dashboard-series";

const first = "2052-04-19T00:00:00.000Z";
const second = "2052-04-20T00:00:00.000Z";
const end = "2052-04-21T00:00:00.000Z";

function series(id: string, kind: DashboardTimeSeries["kind"] = "COUNT"): DashboardTimeSeries {
  return {
    id, label: id, kind, granularity: "DAY", aggregation: "SUM", formula: "legado", drilldownId: id,
    points: [
      { bucket: "2052-04-19", from: first, to: second, value: 99, numerator: 99, denominator: null },
      { bucket: "2052-04-20", from: second, to: end, value: 99, numerator: 99, denominator: null },
    ],
  };
}

function fact(input: Partial<IntegratedActivityFact> & Pick<IntegratedActivityFact, "id" | "eventType" | "occurredAt">): IntegratedActivityFact {
  return {
    sourceEntityType: "Task", leadId: "lead-1", creditedMemberId: "seller-1", performedByMemberId: "seller-1",
    bookedByMemberId: null, taskKind: null, result: null, quantity: 1, valueCents: null, ...input,
  };
}

describe("séries comerciais do log integrado", () => {
  it("conta cada lead uma vez e move a qualificação corrigida para a data vigente", () => {
    const facts = [
      fact({ id: "c1", eventType: "CALL_CONNECTED", occurredAt: first, leadId: "lead-1" }),
      fact({ id: "c2", eventType: "CALL_CONNECTED", occurredAt: second, leadId: "lead-1" }),
      fact({ id: "r1", eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: second, leadId: "lead-2" }),
      fact({ id: "q1", eventType: "LEAD_QUALIFIED", occurredAt: first, leadId: "lead-2" }),
      fact({ id: "q2", eventType: "LEAD_QUALIFIED", occurredAt: first, leadId: "lead-2", quantity: -1 }),
      fact({ id: "q3", eventType: "LEAD_QUALIFIED", occurredAt: second, leadId: "lead-2" }),
    ];
    const result = mergeIntegratedActivitySeries([series("connected"), series("qualified")], facts);
    expect(result.map((item) => [item.id, item.points.map((point) => point.value)])).toEqual([
      ["connected", [1, 2]], ["qualified", [0, 1]],
    ]);
  });

  it("une ligação e resposta no mesmo lead e reposiciona a conexão quando a ligação é revertida", () => {
    const facts = [
      fact({ id: "call", eventType: "CALL_CONNECTED", occurredAt: first, leadId: "lead-1" }),
      fact({ id: "response", eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: second, leadId: "lead-1" }),
      fact({ id: "reversal", eventType: "CALL_CONNECTED", occurredAt: first, leadId: "lead-1", quantity: -1 }),
    ];
    expect(mergeIntegratedActivitySeries([series("connected")], facts.slice(0, 2))[0]?.points.map((point) => point.value)).toEqual([1, 1]);
    expect(mergeIntegratedActivitySeries([series("connected")], facts)[0]?.points.map((point) => point.value)).toEqual([0, 1]);
  });

  it("conta nova resposta no período mesmo após a primeira resposta histórica do lead", () => {
    const facts = [
      fact({ id: "first-response", eventType: "HUMAN_RESPONSE_CONFIRMED", occurredAt: first, leadId: "lead-1" }),
      fact({ id: "first-message", eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: first, leadId: "lead-1" }),
      fact({ id: "second-message", eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: second, leadId: "lead-1" }),
    ];
    expect(mergeIntegratedActivitySeries([series("connected")], facts)[0]?.points.map((point) => point.value)).toEqual([1, 1]);
  });

  it("mantém a segunda conexão quando a primeira de duas ocorrências é estornada", () => {
    const facts = [
      fact({ id: "first", eventType: "CALL_CONNECTED", occurredAt: first, leadId: "lead-1" }),
      fact({ id: "second", eventType: "CALL_CONNECTED", occurredAt: second, leadId: "lead-1" }),
      fact({ id: "reversal", eventType: "CALL_CONNECTED", occurredAt: first, leadId: "lead-1", quantity: -1 }),
    ];
    expect(mergeIntegratedActivitySeries([series("connected")], facts)[0]?.points.map((point) => point.value)).toEqual([0, 1]);
  });

  it("separa reunião criada na agenda de card marcado e soma vendas com receita", () => {
    const facts = [
      fact({ id: "stage", eventType: "MEETING_SCHEDULED", sourceEntityType: "StageHistory", occurredAt: first }),
      fact({ id: "meeting", eventType: "MEETING_SCHEDULED", sourceEntityType: "MeetingHistory", occurredAt: first }),
      fact({ id: "proposal-stage", eventType: "STAGE_ENTERED", sourceEntityType: "StageHistory", occurredAt: first }),
      fact({ id: "offer", eventType: "PROPOSAL_REACHED", sourceEntityType: "Offer", occurredAt: second }),
      fact({ id: "sale", eventType: "SALE_WON", sourceEntityType: "OpportunityOutcomeSnapshot", occurredAt: second, valueCents: "12500" }),
    ];
    const result = mergeIntegratedActivitySeries([series("scheduled"), series("proposals"), series("sales"), series("revenue", "MONEY")], facts);
    expect(result.map((item) => [item.id, item.points.map((point) => point.value)])).toEqual([
      ["scheduled", [1, 0]], ["proposals", [0, 1]], ["sales", [0, 1]], ["revenue", ["0", "12500"]],
    ]);
  });

  it("mostra zero para cards marcados sem reunião na agenda e mantém legado sem fatos relacionados", () => {
    const legacy = series("scheduled");
    expect(mergeIntegratedActivitySeries([legacy], [fact({ id: "stage", eventType: "MEETING_SCHEDULED", sourceEntityType: "StageHistory", occurredAt: first })])[0]?.points.map((point) => point.value)).toEqual([0, 0]);
    expect(mergeIntegratedActivitySeries([series("sales"), series("revenue", "MONEY")], [fact({ id: "call", eventType: "CALL_ATTEMPTED", occurredAt: first })]).map((item) => item.points.map((point) => point.value))).toEqual([[0, 0], ["0", "0"]]);
    expect(mergeIntegratedActivitySeries([legacy], [])).toEqual([legacy]);
  });
});
