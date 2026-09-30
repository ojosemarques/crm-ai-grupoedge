import { describe, expect, it } from "vitest";
import { copilotActionInputGuide, copilotOutputSchema, copilotResponseSchema } from "./copilot-contracts";

type SchemaNode = {
  properties?: Record<string, SchemaNode>;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  pattern?: string;
  additionalProperties?: boolean;
  maxLength?: number;
};
const response = copilotResponseSchema as SchemaNode;
const operations = response.properties!.operation!.anyOf![0]!.oneOf!;
const operation = (kind: string) => operations.find((schema) => schema.properties!.kind!.const === kind)!;
const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-10-01T10:00:00-03:00";

describe("contrato fornecido ao modelo do Copilot", () => {
  it("publica todos os tipos de ação e campos obrigatórios no schema de resposta", () => {
    expect(response.required).toEqual(expect.arrayContaining(["answer", "sources", "sale", "operation", "searches"]));
    expect(operations.map((schema) => schema.properties!.kind!.const)).toEqual(["CREATE_TASK", "UPDATE_CUSTOMER", "CREATE_EXPENSE", "RECORD_PAYMENT"]);
    expect(operation("CREATE_EXPENSE").required).toEqual(expect.arrayContaining(["categoryId", "financialAccountId", "amountCents", "competenceAt", "dueAt", "status"]));
    expect(operation("RECORD_PAYMENT").required).toEqual(expect.arrayContaining(["invoiceId", "expectedRevision", "receivedAt", "method", "reference", "receiptConfirmed"]));
    expect(operation("RECORD_PAYMENT").properties!.reference!.maxLength).toBe(180);
    expect(response.additionalProperties).toBe(false);
    for (const schema of operations) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).not.toHaveProperty("workspaceId");
      expect(schema.properties).not.toHaveProperty("confirmed");
      expect(schema.properties).not.toHaveProperty("idempotencyKey");
    }
  });

  it("informa enums de cadastro e nomes exatos da evidência de aceite", () => {
    const changes = operation("UPDATE_CUSTOMER").properties!.changes!.properties!;
    expect(changes.segment!.enum).toEqual(["PUBLIC_SECTOR", "POLITICAL", "PRIVATE_SECTOR", "NONPROFIT", "OTHER", "UNKNOWN"]);
    expect(changes.size!.enum).toEqual(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"]);
    const sale = response.properties!.sale!.anyOf![0]!;
    expect(sale.properties!.acceptance!.required).toEqual(["acceptedByName", "acceptedByRole", "evidenceText"]);
    expect(sale.properties!.customer!.oneOf!.map((schema) => schema.properties!.mode!.const)).toEqual(["CREATE", "LINK"]);
    expect(sale.properties!.sellerMemberId!.format).toBe("uuid");
    expect(sale.properties!.sellerMemberId!.pattern).toBeUndefined();
    expect(sale.properties!.startsAt!.format).toBe("date-time");
    expect(sale.properties!.monthlyCents!.pattern).toBeDefined();
  });

  it("complementa no guia as regras relacionais e origens dos IDs", () => {
    expect(Object.keys(copilotActionInputGuide)).toHaveLength(5);
    expect(copilotActionInputGuide.CREATE_TASK.outputField).toBe("operation");
    expect(copilotActionInputGuide.CREATE_TASK.references.leadId).toBe("actionOptions.leads[].id");
    expect(copilotActionInputGuide.CLOSE_SALE.outputField).toBe("sale");
    expect(copilotActionInputGuide.CLOSE_SALE.references.templateVersionId).toContain("contratos");
    expect(copilotActionInputGuide.CREATE_EXPENSE.rules.join(" ")).toContain("omita settledAt e paymentConfirmed");
    expect(copilotActionInputGuide.RECORD_PAYMENT.rules.join(" ")).toContain("outstandingCents");
    expect(copilotActionInputGuide.CLOSE_SALE.rules.join(" ")).toContain("onboardingOwnerMemberId exige acceptance");
  });

  it("continua rejeitando enum traduzido, duas ações e pagamento sem declaração real", () => {
    const customer = { kind: "UPDATE_CUSTOMER", accountId: id, expectedRevision: 1, changes: { size: "pequeno" } };
    expect(copilotOutputSchema.safeParse({ answer: "Revisar", sources: [], operation: customer }).success).toBe(false);
    const expense = { kind: "CREATE_EXPENSE", categoryId: id, financialAccountId: id, description: "Despesa", amountCents: "100", competenceAt: at, dueAt: at, status: "SETTLED" };
    expect(copilotOutputSchema.safeParse({ answer: "Revisar", sources: [], operation: expense }).success).toBe(false);
    const sale = { opportunityId: id, expectedRevision: 1, sellerMemberId: id, totalCents: "100", monthlyCents: "100", upfrontCents: "0", durationMonths: 1, startsAt: at, templateVersionId: id };
    expect(copilotOutputSchema.safeParse({ answer: "Revisar", sources: [], sale, operation: { ...customer, changes: { size: "SMALL" } } }).success).toBe(false);
  });
});
