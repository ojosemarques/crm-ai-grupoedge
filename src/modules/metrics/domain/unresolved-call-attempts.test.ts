import { describe, expect, it } from "vitest";
import { countUnresolvedCallAttempts } from "./unresolved-call-attempts";

describe("ligações sem desfecho", () => {
  it("não usa o resultado de outro lead para encobrir uma tentativa pendente", () => {
    expect(countUnresolvedCallAttempts([
      { eventType: "CALL_ATTEMPTED", leadId: "a", quantity: 2 },
      { eventType: "CALL_UNANSWERED", leadId: "a", quantity: 1 },
      { eventType: "CALL_CONNECTED", leadId: "b", quantity: 1 },
    ])).toBe(1);
  });

  it("respeita fatos compensatórios antes de avaliar o saldo", () => {
    expect(countUnresolvedCallAttempts([
      { eventType: "CALL_ATTEMPTED", leadId: "a", quantity: 1 },
      { eventType: "CALL_UNANSWERED", leadId: "a", quantity: 1 },
      { eventType: "CALL_UNANSWERED", leadId: "a", quantity: -1 },
    ])).toBe(1);
  });
});
