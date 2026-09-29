import { describe, expect, it } from "vitest";

import { canTransitionDsr, decidePrivacy, deriveConsentState } from "@/modules/privacy/domain/privacy-policy";

describe("privacy policy", () => {
  it("separa ausência de negativa explícita", () => {
    expect(deriveConsentState([])).toBe("UNKNOWN");
    expect(deriveConsentState([{ action: "DENIED", effect: "DENIED", occurredAt: new Date() }])).toBe("DENIED");
  });

  it("mantém opt-out como precedência restritiva", () => {
    expect(deriveConsentState([
      { action: "OPTED_OUT", effect: "DENIED", occurredAt: new Date("2026-01-01") },
      { action: "GRANTED", effect: "GRANTED", occurredAt: new Date("2026-02-01") },
    ])).toBe("OPTED_OUT");
  });

  it("não autoriza com política draft", () => {
    expect(decidePrivacy({
      contactPointDoNotContact: false,
      legacyDoNotContact: false,
      consentState: "GRANTED",
      purposeStatus: "DRAFT",
      legalBasisStatus: "DRAFT",
      enforced: false,
    })).toMatchObject({ outcome: "REVIEW_REQUIRED", reasonCodes: ["PURPOSE_NOT_ACTIVE"] });
  });

  it("nega hard opt-out mesmo em modo shadow", () => {
    expect(decidePrivacy({
      contactPointDoNotContact: true,
      legacyDoNotContact: false,
      consentState: "UNKNOWN",
      purposeStatus: null,
      legalBasisStatus: null,
      enforced: false,
    }).outcome).toBe("DENY");
  });

  it("valida a máquina de estados de solicitações", () => {
    expect(canTransitionDsr("RECEIVED", "IDENTITY_PENDING")).toBe(true);
    expect(canTransitionDsr("COMPLETED", "IN_REVIEW")).toBe(false);
  });

  it.each([
    ["DENIED", "DENY"],
    ["REVOKED", "DENY"],
    ["OPTED_OUT", "DENY"],
    ["UNKNOWN", "REVIEW_REQUIRED"],
    ["REVIEW_REQUIRED", "REVIEW_REQUIRED"],
  ] as const)("mapeia %s sem criar autorização permissiva", (consentState, outcome) => {
    expect(decidePrivacy({ contactPointDoNotContact: false, legacyDoNotContact: false, consentState, purposeStatus: "ACTIVE", legalBasisStatus: "ACTIVE", enforced: true }).outcome).toBe(outcome);
  });

  it("autoriza somente concessão com finalidade e base ativas", () => {
    expect(decidePrivacy({ contactPointDoNotContact: false, legacyDoNotContact: false, consentState: "GRANTED", purposeStatus: "ACTIVE", legalBasisStatus: "ACTIVE", enforced: true })).toMatchObject({ outcome: "ALLOW", reasonCodes: ["VALID_ACTIVE_POLICY"] });
  });
});
