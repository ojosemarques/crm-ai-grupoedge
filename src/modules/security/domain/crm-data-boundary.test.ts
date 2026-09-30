import { describe, expect, it } from "vitest";

import {
  CRM_COMMERCIAL_DATA_CATEGORIES,
  CRM_COMMERCIAL_DOMAIN,
  CRM_COMMERCIAL_PURPOSES,
  CRM_DATA_BOUNDARY_VERSION,
  decideCrmDataBoundary,
} from "@/modules/security/domain/crm-data-boundary";

describe("fronteira de dados do CRM comercial", () => {
  it("autoriza somente a combinação integralmente allowlisted", () => {
    expect(decideCrmDataBoundary({
      sourceDomain: CRM_COMMERCIAL_DOMAIN,
      purpose: "commercial-negotiation",
      dataCategory: "CONTRACT_REVENUE",
    })).toEqual({
      outcome: "ALLOW",
      reasonCode: "COMMERCIAL_SCOPE_CONFIRMED",
      policyVersion: CRM_DATA_BOUNDARY_VERSION,
    });
  });

  it.each([
    ["POLITIZAI_OS_CITIZEN", "citizen-service", "CITIZEN_CASE", "SOURCE_DOMAIN_NOT_ALLOWED"],
    [CRM_COMMERCIAL_DOMAIN, "citizen-service", "CONTACT", "PURPOSE_NOT_ALLOWED"],
    [CRM_COMMERCIAL_DOMAIN, "account-management", "CITIZEN_CASE", "DATA_CATEGORY_NOT_ALLOWED"],
  ])("nega domínio, finalidade ou categoria fora da fronteira", (sourceDomain, purpose, dataCategory, reasonCode) => {
    expect(decideCrmDataBoundary({ sourceDomain, purpose, dataCategory })).toMatchObject({
      outcome: "DENY",
      reasonCode,
    });
  });

  it("nega valores vazios e desconhecidos por padrão", () => {
    expect(decideCrmDataBoundary({ sourceDomain: "", purpose: "", dataCategory: "" }).outcome).toBe("DENY");
    expect(decideCrmDataBoundary({
      sourceDomain: CRM_COMMERCIAL_DOMAIN,
      purpose: "future-purpose",
      dataCategory: "FUTURE_CATEGORY",
    }).outcome).toBe("DENY");
  });

  it("mantém allowlists explícitas e sem categorias operacionais de cidadãos", () => {
    expect(CRM_COMMERCIAL_PURPOSES).toContain("account-management");
    expect(CRM_COMMERCIAL_DATA_CATEGORIES).toContain("COMMERCIAL");
    expect(CRM_COMMERCIAL_PURPOSES).not.toContain("citizen-service");
    expect(CRM_COMMERCIAL_DATA_CATEGORIES).not.toContain("CITIZEN_CASE");
  });
});
