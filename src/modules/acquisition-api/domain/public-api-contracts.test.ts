import { describe, expect, it } from "vitest";

import {
  API_CONTRACT_VERSION,
  apiListQuerySchema,
  apiResourceSchema,
  createPayloadSchemas,
  deletePayloadSchema,
  updatePayloadSchemas,
} from "@/modules/acquisition-api/domain/public-api-contracts";

const uuid = "10000000-0000-4000-8000-000000000001";

describe("Etapa 14 — contrato da API pública versionada", () => {
  it("expõe somente os cinco recursos homologados e uma versão explícita", () => {
    expect(API_CONTRACT_VERSION).toBe("2026-09-30");
    expect(apiResourceSchema.options).toEqual(["contacts", "accounts", "deals", "sources", "fields"]);
    expect(apiResourceSchema.safeParse("users").success).toBe(false);
  });

  it("limita paginação, normaliza o limite e recusa cursores excessivos ou parâmetros extras", () => {
    expect(apiListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(apiListQuerySchema.parse({ limit: "100", cursor: "cursor-opaco" })).toEqual({ limit: 100, cursor: "cursor-opaco" });
    expect(apiListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(apiListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(apiListQuerySchema.safeParse({ cursor: "x".repeat(501) }).success).toBe(false);
    expect(apiListQuerySchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("valida criação de negócio sem perder precisão monetária e com referências tipadas", () => {
    const parsed = createPayloadSchemas.deals.parse({
      leadId: uuid,
      ownerMemberId: uuid,
      name: "Contrato anual",
      interestDescription: "Implantação anual do CRM.",
      amountCents: "900719925474099300",
      expectedCloseAt: "2026-10-30T12:00:00-03:00",
    });

    expect(parsed).toMatchObject({ amountCents: "900719925474099300", probabilityPercent: 0 });
    expect(createPayloadSchemas.deals.safeParse({ ...parsed, probabilityPercent: 101 }).success).toBe(false);
    expect(createPayloadSchemas.deals.safeParse({ ...parsed, leadId: "controlado-pelo-cliente" }).success).toBe(false);
    expect(createPayloadSchemas.deals.safeParse({ ...parsed, amountCents: "-1" }).success).toBe(false);
  });

  it("mantém chaves externas e campos customizados dentro das listas permitidas", () => {
    expect(createPayloadSchemas.sources.parse({ key: "meta_lead_ads", name: "Meta Lead Ads", type: "PAID_MEDIA" })).toMatchObject({ key: "meta_lead_ads" });
    expect(createPayloadSchemas.sources.safeParse({ key: "Meta Lead Ads", name: "Meta Lead Ads", type: "PAID_MEDIA" }).success).toBe(false);

    expect(createPayloadSchemas.fields.parse({ entityType: "LEAD", key: "faixa_orcamento", name: "Faixa de orçamento", dataType: "SELECT", options: ["Até 10 mil"], required: true })).toMatchObject({ required: true });
    expect(createPayloadSchemas.fields.safeParse({ entityType: "USER", key: "perfil", name: "Perfil", dataType: "TEXT" }).success).toBe(false);
    expect(createPayloadSchemas.fields.safeParse({ entityType: "LEAD", key: "perfil", name: "Perfil", dataType: "TEXT", injected: true }).success).toBe(false);
  });

  it("exige precondição otimista nas atualizações e impede alteração de identificadores imutáveis", () => {
    expect(updatePayloadSchemas.contacts.safeParse({ preferredName: "Maria" }).success).toBe(false);
    expect(updatePayloadSchemas.contacts.safeParse({ preferredName: "Maria", expectedUpdatedAt: "2026-09-30T12:00:00Z" }).success).toBe(true);
    expect(updatePayloadSchemas.accounts.safeParse({ name: "Conta nova", expectedRevision: 0 }).success).toBe(false);
    expect(updatePayloadSchemas.accounts.safeParse({ name: "Conta nova", expectedRevision: 2 }).success).toBe(true);
    expect(updatePayloadSchemas.fields.safeParse({ expectedRevision: 1, key: "chave_trocada" }).success).toBe(false);
    expect(updatePayloadSchemas.deals.safeParse({ expectedRevision: 1, leadId: uuid }).success).toBe(false);
  });

  it("restringe exclusão a motivo auditável e metadados de concorrência conhecidos", () => {
    expect(deletePayloadSchema.parse({ expectedRevision: 3, reason: "Registro duplicado" })).toEqual({ expectedRevision: 3, reason: "Registro duplicado" });
    expect(deletePayloadSchema.safeParse({ expectedRevision: 3, reason: "ok" }).success).toBe(false);
    expect(deletePayloadSchema.safeParse({ expectedRevision: 3, reason: "Registro duplicado", hardDelete: true }).success).toBe(false);
  });
});
