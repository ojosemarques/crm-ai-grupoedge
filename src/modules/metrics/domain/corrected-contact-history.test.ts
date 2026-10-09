import { describe, expect, it } from "vitest";
import { summarizeCorrectedContactHistory } from "./corrected-contact-history";

describe("histórico efetivo de contatos", () => {
  it("substitui o desfecho corrigido e preserva uma resposta posterior", () => {
    const first = new Date("2032-07-18T15:00:00.000Z");
    const second = new Date("2032-07-18T16:00:00.000Z");
    const rows = [
      { id: "call-1", type: "CALL_CONNECTED", direction: "OUTBOUND", result: "CONNECTED", occurredAt: first, createdAt: first, correctsActivityId: null, newValues: null },
      { id: "call-2", type: "CALL_CONNECTED", direction: "OUTBOUND", result: "CONNECTED", occurredAt: second, createdAt: second, correctsActivityId: null, newValues: null },
      { id: "correction", type: "CALL_CONNECTED", direction: "INTERNAL", result: "CORRECTED", occurredAt: second, createdAt: new Date(second.getTime() + 1), correctsActivityId: "call-1", newValues: { result: "NOT_CONNECTED" } },
      { id: "text-correction", type: "CALL_CONNECTED", direction: "INTERNAL", result: "CORRECTED", occurredAt: second, createdAt: new Date(second.getTime() + 2), correctsActivityId: "call-1", newValues: { result: null } },
    ];
    const summary = summarizeCorrectedContactHistory(rows);
    expect(summary).toEqual({ outboundCalls: 2, connectedCalls: 1, connectedAt: [second] });
  });
});
