import { describe, expect, it } from "vitest";

import { dataQualityQuerySchema, issueActionSchema, mergeApplySchema, mergePlanSchema, scanInputSchema } from "@/modules/data-quality/domain/data-quality-contracts";

describe("CRM-61 contratos de qualidade", () => {
  it("limita paginação e aceita filtros canônicos", () => {
    expect(dataQualityQuerySchema.parse({})).toMatchObject({ status: "OPEN", page: 1, pageSize: 25 });
    expect(() => dataQualityQuerySchema.parse({ pageSize: 101 })).toThrow();
  });

  it("distingue diagnóstico de execução e exige idempotência", () => {
    expect(scanInputSchema.parse({ mode: "DRY_RUN", idempotencyKey: "crm61:dry:001" }).mode).toBe("DRY_RUN");
    expect(() => scanInputSchema.parse({ mode: "EXECUTE", idempotencyKey: "x" })).toThrow();
  });

  it("exige revisão otimista, motivo e confirmação textual no merge", () => {
    expect(() => issueActionSchema.parse({ issueId: crypto.randomUUID(), action: "RESOLVE", reason: "ok", expectedRevision: 1 })).toThrow();
    expect(() => mergePlanSchema.parse({ candidateId: crypto.randomUUID(), survivorEntityId: crypto.randomUUID(), reason: "muito curto", previewFingerprint: "abc", decisions: [] })).toThrow();
    expect(() => mergeApplySchema.parse({ mergePlanId: crypto.randomUUID(), expectedRevision: 1, idempotencyKey: "crm61:merge:001", confirmation: "sim" })).toThrow();
  });
});
