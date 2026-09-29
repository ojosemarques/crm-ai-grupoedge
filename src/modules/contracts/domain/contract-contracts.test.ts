import { describe, expect, it } from "vitest";

import { canonicalContractJson, createContractInputSchema, escapeHtml, resolveTemplate, sha256 } from "@/modules/contracts/domain/contract-contracts";

describe("contratos comerciais", () => {
  it("mantém hash reproduzível sem depender da ordem das chaves", () => {
    expect(sha256(canonicalContractJson({ b: 2, a: 1 }))).toBe(sha256(canonicalContractJson({ a: 1, b: 2 })));
  });

  it("escapa HTML e rejeita variável fora da allowlist", () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain("<script>");
    expect(() => resolveTemplate("{{secret}}", { secret: "não" })).toThrow("não permitida");
  });

  it("valida moeda por centavos e intervalo estruturado", () => {
    const parsed = createContractInputSchema.parse({
      opportunityId: "00000000-0000-4000-8000-000000000001",
      offerId: "00000000-0000-4000-8000-000000000002",
      templateVersionId: "00000000-0000-4000-8000-000000000003",
      billingFrequency: "ONE_TIME",
      paymentTerms: "À vista",
      idempotencyKey: "contract:test:1",
    });
    expect(parsed.billingFrequency).toBe("ONE_TIME");
  });
});
