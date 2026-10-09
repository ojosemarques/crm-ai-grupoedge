import { describe, expect, it } from "vitest";
import { summarizeLeadCohortRate } from "./metric-cohort";

describe("taxa de resposta por coorte de leads", () => {
  it("conta só respostas dos leads abordados no período, uma vez por lead", () => {
    expect(summarizeLeadCohortRate([
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "a", quantity: 1 },
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "b", quantity: 1 },
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "c", quantity: 1 },
    ], [
      { eventType: "CALL_ATTEMPTED", leadId: "a", quantity: 2 },
      { eventType: "EMAIL_SENT", leadId: "a", quantity: 1 },
      { eventType: "EMAIL_SENT", leadId: "b", quantity: 1 },
      { eventType: "EMAIL_SENT", leadId: "b", quantity: -1 },
    ])).toEqual({ numerator: 1, denominator: 1 });
  });
});
