import { describe, expect, it } from "vitest";
import { copilotActionSchema } from "./copilot-action-contracts";

const id = "2f851ccf-f96a-469f-9703-44b0a7da6042";
const expense = { kind: "CREATE_EXPENSE", categoryId: id, financialAccountId: id, description: "Licença mensal", amountCents: "30000", competenceAt: "2026-09-30T12:00:00-03:00", dueAt: "2026-10-05T12:00:00-03:00", status: "PLANNED" };

describe("contratos das ações do Copilot", () => {
  it("despesa paga exige atestado real e data; prevista não aceita baixa implícita", () => {
    expect(copilotActionSchema.parse(expense)).toMatchObject({ status: "PLANNED" });
    expect(() => copilotActionSchema.parse({ ...expense, status: "SETTLED" })).toThrow();
    expect(() => copilotActionSchema.parse({ ...expense, paymentConfirmed: true })).toThrow();
    expect(copilotActionSchema.parse({ ...expense, status: "SETTLED", settledAt: expense.competenceAt, paymentConfirmed: true })).toMatchObject({ status: "SETTLED" });
  });
  it("rejeita quantias negativas, imprecisas e campos de execução arbitrária", () => {
    for (const amountCents of ["-1", "0", "1.50", "9007199254740992"]) expect(copilotActionSchema.safeParse({ ...expense, amountCents }).success).toBe(false);
    expect(copilotActionSchema.safeParse({ ...expense, sql: "update financial_entries" }).success).toBe(false);
    expect(copilotActionSchema.safeParse({ ...expense, workspaceId: id }).success).toBe(false);
  });
  it("edição de cliente exige campo permitido, versão e alteração concreta", () => {
    const input = { kind: "UPDATE_CUSTOMER", accountId: id, expectedRevision: 1, changes: { name: "Cliente atualizado" } };
    expect(copilotActionSchema.parse(input)).toEqual(input);
    expect(copilotActionSchema.safeParse({ ...input, changes: {} }).success).toBe(false);
    expect(copilotActionSchema.safeParse({ ...input, changes: { status: "INACTIVE" } }).success).toBe(false);
  });
  it("recebimento exige atestado, referência e revisão e tarefas exigem fuso", () => {
    const receipt = { kind: "RECORD_PAYMENT", invoiceId: id, expectedRevision: 1, financialAccountId: id, amountCents: "30000", receivedAt: expense.competenceAt, method: "PIX", reference: "Comprovante 123", receiptConfirmed: true };
    expect(copilotActionSchema.parse(receipt)).toEqual(receipt);
    expect(copilotActionSchema.safeParse({ ...receipt, receiptConfirmed: false }).success).toBe(false);
    expect(copilotActionSchema.safeParse({ ...receipt, reference: "" }).success).toBe(false);
    expect(copilotActionSchema.safeParse({ kind: "CREATE_TASK", leadId: id, title: "Telefonar", dueAt: "2026-10-01T10:00:00" }).success).toBe(false);
  });
});
