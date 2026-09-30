export const CRM_DATA_BOUNDARY_VERSION = "commercial-crm-boundary-v1";

export const CRM_COMMERCIAL_DOMAIN = "COMMERCIAL_CRM" as const;

export const CRM_COMMERCIAL_PURPOSES = [
  "sales-prospecting",
  "account-management",
  "commercial-negotiation",
  "contracting",
  "customer-onboarding",
  "customer-success",
  "customer-support",
  "renewal-expansion",
  "security-audit",
  "legal-compliance",
] as const;

export const CRM_COMMERCIAL_DATA_CATEGORIES = [
  "IDENTITY",
  "CONTACT",
  "COMMERCIAL",
  "QUALIFICATION",
  "COMMUNICATION",
  "MARKETING_ATTRIBUTION",
  "CONTRACT_REVENUE",
  "SUPPORT_SUCCESS",
  "SECURITY_AUDIT",
  "RAW_PAYLOAD",
] as const;

export type CrmCommercialPurpose = (typeof CRM_COMMERCIAL_PURPOSES)[number];
export type CrmCommercialDataCategory = (typeof CRM_COMMERCIAL_DATA_CATEGORIES)[number];

export type CrmDataBoundaryInput = Readonly<{
  sourceDomain: string;
  purpose: string;
  dataCategory: string;
}>;

export type CrmDataBoundaryDecision = Readonly<{
  outcome: "ALLOW" | "DENY";
  reasonCode:
    | "COMMERCIAL_SCOPE_CONFIRMED"
    | "SOURCE_DOMAIN_NOT_ALLOWED"
    | "PURPOSE_NOT_ALLOWED"
    | "DATA_CATEGORY_NOT_ALLOWED";
  policyVersion: typeof CRM_DATA_BOUNDARY_VERSION;
}>;

const purposes = new Set<string>(CRM_COMMERCIAL_PURPOSES);
const categories = new Set<string>(CRM_COMMERCIAL_DATA_CATEGORIES);

/**
 * Classifies whether data belongs inside the commercial CRM boundary.
 * This technical allowlist does not replace consent, legal-basis, retention,
 * workspace authorization, or field-level minimization checks.
 */
export function decideCrmDataBoundary(input: CrmDataBoundaryInput): CrmDataBoundaryDecision {
  if (input.sourceDomain !== CRM_COMMERCIAL_DOMAIN) {
    return {
      outcome: "DENY",
      reasonCode: "SOURCE_DOMAIN_NOT_ALLOWED",
      policyVersion: CRM_DATA_BOUNDARY_VERSION,
    };
  }

  if (!purposes.has(input.purpose)) {
    return {
      outcome: "DENY",
      reasonCode: "PURPOSE_NOT_ALLOWED",
      policyVersion: CRM_DATA_BOUNDARY_VERSION,
    };
  }

  if (!categories.has(input.dataCategory)) {
    return {
      outcome: "DENY",
      reasonCode: "DATA_CATEGORY_NOT_ALLOWED",
      policyVersion: CRM_DATA_BOUNDARY_VERSION,
    };
  }

  return {
    outcome: "ALLOW",
    reasonCode: "COMMERCIAL_SCOPE_CONFIRMED",
    policyVersion: CRM_DATA_BOUNDARY_VERSION,
  };
}
