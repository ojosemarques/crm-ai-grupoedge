import { describe, expect, it } from "vitest";

import {
  ACQUISITION_CONTRACT_VERSION,
  ACQUISITION_MAX_WEBHOOK_BYTES,
  acquisitionConnectionCommandSchema,
  acquisitionConnectionSchema,
  acquisitionProviderSchema,
} from "@/modules/acquisition-api/domain/acquisition-contracts";

const connectionId = "10000000-0000-4000-8000-000000000001";
const base = {
  key: "lead-form-site",
  displayName: "Formulário do site",
  provider: "FORM" as const,
  sourceKey: "site-organico",
  secretReferenceKey: "ACQUISITION_SITE_WEBHOOK_SECRET",
  mapping: { fullName: "lead.name", phone: "lead.phone", consent: "lead.consent" },
};

describe("Etapa 14 — contrato de aquisição", () => {
  it("fixa versão, limite de entrada e provedores homologados", () => {
    expect(ACQUISITION_CONTRACT_VERSION).toBe("1.0");
    expect(ACQUISITION_MAX_WEBHOOK_BYTES).toBe(256 * 1024);
    expect(acquisitionProviderSchema.options).toEqual(["FORM", "LANDING_PAGE", "META_LEAD_ADS", "TYPEFORM"]);
    expect(acquisitionProviderSchema.safeParse("GENERIC_SQL").success).toBe(false);
  });

  it("exige nome e telefone no mapeamento e uma referência de segredo permitida", () => {
    expect(acquisitionConnectionSchema.safeParse(base).success).toBe(true);
    expect(acquisitionConnectionSchema.safeParse({ ...base, mapping: { fullName: "lead.name" } }).success).toBe(false);
    expect(acquisitionConnectionSchema.safeParse({ ...base, secretReferenceKey: "DATABASE_URL" }).success).toBe(false);
    expect(acquisitionConnectionSchema.safeParse({ ...base, mapping: { ...base.mapping, password: "lead.password" } }).success).toBe(false);
  });

  it("obriga URL canônica válida para landing page", () => {
    expect(acquisitionConnectionSchema.safeParse({ ...base, provider: "LANDING_PAGE" }).success).toBe(false);
    expect(acquisitionConnectionSchema.safeParse({ ...base, provider: "LANDING_PAGE", definition: { name: "Campanha municipal", canonicalUrl: "https://example.test/campanha" } }).success).toBe(true);
    expect(acquisitionConnectionSchema.safeParse({ ...base, provider: "LANDING_PAGE", definition: { name: "Campanha municipal", canonicalUrl: "javascript:alert(1)" } }).success).toBe(false);
  });

  it("aceita atualização de mapeamento somente com campos canônicos mínimos", () => {
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "UPDATE_MAPPING", connectionId, revision: 2, mapping: { fullName: "answers.name", phone: "answers.phone", utmSource: "hidden.utm_source" } }).success).toBe(true);
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "UPDATE_MAPPING", connectionId, revision: 2, mapping: { fullName: "answers.name" } }).success).toBe(false);
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "UPDATE_MAPPING", connectionId, revision: 2, mapping: { fullName: "answers[0].name", phone: "answers.phone" } }).success).toBe(false);
  });

  it("exige revisão e justificativa auditável para rollback e revogação", () => {
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "ROLLBACK_MAPPING", connectionId, revision: 4, targetVersion: 2, reason: "Falha no mapeamento atual" }).success).toBe(true);
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "ROLLBACK_MAPPING", connectionId, revision: 4, targetVersion: 0, reason: "Falha no mapeamento atual" }).success).toBe(false);
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "REVOKE", connectionId, revision: 4, reason: "ok" }).success).toBe(false);
    expect(acquisitionConnectionCommandSchema.safeParse({ action: "REVOKE", connectionId, revision: 4, reason: "Credencial comprometida" }).success).toBe(true);
  });
});
