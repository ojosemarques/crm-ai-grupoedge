import { describe, expect, it } from "vitest";

import {
  createN8nMachineSchema,
  n8nCommandSchema,
  n8nEventQuerySchema,
  n8nEventTypes,
  n8nMachineRequestHeadersSchema,
  n8nRecipeCatalog,
} from "@/modules/integrations/domain/n8n-contracts";

describe("CRM-60 — contratos versionados do sandbox n8n", () => {
  it("mantém eventos e receitas em allowlists curtas e explícitas", () => {
    expect(n8nEventTypes).toContain("lead.assigned");
    expect(n8nEventTypes).toContain("customer_service.critical_request");
    expect(n8nRecipeCatalog).toHaveLength(9);
    expect(n8nRecipeCatalog.every((recipe) => n8nEventTypes.includes(recipe.trigger))).toBe(true);
  });

  it("rejeita campos extras, escopos duplicados e paginação excessiva", () => {
    const base = {
      key: "n8n-local",
      name: "n8n local",
      purpose: "Workflow governado do sandbox local.",
      ownerMemberId: "00000000-0000-4000-8000-000000000001",
      scopes: ["EVENTS_READ"],
      expiresAt: "2055-09-14T12:00:00.000Z",
    };
    expect(createN8nMachineSchema.safeParse({ ...base, secret: "não permitido" }).success).toBe(false);
    expect(createN8nMachineSchema.safeParse({ ...base, scopes: ["EVENTS_READ", "EVENTS_READ"] }).success).toBe(false);
    expect(n8nEventQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("exige assinatura, idempotência e comando reconhecido", () => {
    expect(n8nMachineRequestHeadersSchema.safeParse({
      authorization: "Bearer n8n_local_1234567890123456",
      timestamp: "2055-09-13T12:00:00.000Z",
      nonce: "nonce_fixture_1234",
      signature: "a".repeat(64),
      idempotencyKey: "crm60.command.001",
      correlationId: "crm60.command.001",
      causationDepth: 1,
    }).success).toBe(true);

    expect(n8nCommandSchema.safeParse({
      type: "SQL",
      targetType: "ACCOUNT",
      targetId: "00000000-0000-4000-8000-000000000001",
      statement: "SELECT *",
    }).success).toBe(false);
  });
});
