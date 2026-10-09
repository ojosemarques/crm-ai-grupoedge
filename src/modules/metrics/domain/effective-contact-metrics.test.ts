import { describe, expect, it } from "vitest";
import { summarizeEffectiveContacts } from "./effective-contact-metrics";

describe("contatos efetivos por lead e vendedor", () => {
  it("une ligação e resposta, mantém vendedores separados e respeita reversões", () => {
    const rows = [
      { eventType: "CALL_CONNECTED", leadId: "lead-1", creditedMemberId: "seller-1", quantity: 1 },
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "lead-1", creditedMemberId: "seller-1", quantity: 1 },
      { eventType: "CALL_CONNECTED", leadId: "lead-2", creditedMemberId: "seller-1", quantity: 1 },
      { eventType: "CALL_CONNECTED", leadId: "lead-2", creditedMemberId: "seller-1", quantity: -1 },
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "lead-3", creditedMemberId: "seller-2", quantity: 1 },
      { eventType: "CALL_ATTEMPTED", leadId: "lead-4", creditedMemberId: "seller-2", quantity: 1 },
    ];
    const summary = summarizeEffectiveContacts(rows);
    expect(summary.total).toBe(2);
    expect([...summary.byMember]).toEqual([["seller-1", 1], ["seller-2", 1]]);
  });

  it("não duplica o total do workspace quando dois vendedores contatam o mesmo lead", () => {
    const summary = summarizeEffectiveContacts([
      { eventType: "CALL_CONNECTED", leadId: "lead-1", creditedMemberId: "seller-1", quantity: 1 },
      { eventType: "INBOUND_MESSAGE_RECEIVED", leadId: "lead-1", creditedMemberId: "seller-2", quantity: 1 },
    ]);
    expect(summary.total).toBe(1);
    expect([...summary.byMember.values()]).toEqual([1, 1]);
  });
});
