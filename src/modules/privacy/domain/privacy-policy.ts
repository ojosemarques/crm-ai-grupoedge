import type {
  ConsentAction,
  ConsentEffect,
  ConsentStateValue,
  DataSubjectRequestStatus,
  PrivacyDecisionOutcome,
  PrivacyPolicyStatus,
} from "@/generated/prisma/client";

export const PRIVACY_RULE_VERSION = "privacy-decision-v1";
export const LEGACY_PURPOSE_CODE = "legacy-commercial-contact";
export const LEGACY_NOTICE_VERSION = "legacy-signal-v1";

export type ConsentSignal = Readonly<{
  action: ConsentAction;
  effect: ConsentEffect;
  occurredAt: Date;
}>;

const statePriority: Readonly<Record<ConsentStateValue, number>> = {
  UNKNOWN: 0,
  GRANTED: 1,
  REVIEW_REQUIRED: 2,
  DENIED: 3,
  REVOKED: 4,
  OPTED_OUT: 5,
};

export function stateForSignal(signal: ConsentSignal): ConsentStateValue {
  if (signal.action === "OPTED_OUT") return "OPTED_OUT";
  if (signal.action === "REVOKED") return "REVOKED";
  if (signal.action === "DENIED") return "DENIED";
  if (signal.action === "GRANTED" && signal.effect === "GRANTED") return "GRANTED";
  return "REVIEW_REQUIRED";
}

export function deriveConsentState(signals: readonly ConsentSignal[]): ConsentStateValue {
  if (signals.length === 0) return "UNKNOWN";
  return signals
    .map(stateForSignal)
    .sort((left, right) => statePriority[right] - statePriority[left])[0] ?? "UNKNOWN";
}

export type DecisionFacts = Readonly<{
  contactPointDoNotContact: boolean;
  legacyDoNotContact: boolean;
  consentState: ConsentStateValue;
  purposeStatus: PrivacyPolicyStatus | null;
  legalBasisStatus: PrivacyPolicyStatus | null;
  enforced: boolean;
}>;

export type DeterministicPrivacyDecision = Readonly<{
  outcome: PrivacyDecisionOutcome;
  reasonCodes: readonly string[];
  missingEvidence: readonly string[];
}>;

export function decidePrivacy(facts: DecisionFacts): DeterministicPrivacyDecision {
  if (facts.contactPointDoNotContact || facts.legacyDoNotContact || facts.consentState === "OPTED_OUT" || facts.consentState === "REVOKED") {
    return { outcome: "DENY", reasonCodes: ["HARD_OPT_OUT"], missingEvidence: [] };
  }
  if (facts.consentState === "DENIED") {
    return { outcome: "DENY", reasonCodes: ["EXPLICIT_DENIAL"], missingEvidence: [] };
  }
  if (facts.purposeStatus !== "ACTIVE") {
    return { outcome: "REVIEW_REQUIRED", reasonCodes: ["PURPOSE_NOT_ACTIVE"], missingEvidence: ["active_purpose_version"] };
  }
  if (facts.legalBasisStatus !== "ACTIVE") {
    return { outcome: "REVIEW_REQUIRED", reasonCodes: ["LEGAL_BASIS_NOT_ACTIVE"], missingEvidence: ["active_legal_basis"] };
  }
  if (facts.consentState === "GRANTED") {
    return { outcome: "ALLOW", reasonCodes: [facts.enforced ? "VALID_ACTIVE_POLICY" : "SHADOW_VALID_ACTIVE_POLICY"], missingEvidence: [] };
  }
  return { outcome: "REVIEW_REQUIRED", reasonCodes: [facts.consentState === "UNKNOWN" ? "CONSENT_UNKNOWN" : "CONSENT_REVIEW_REQUIRED"], missingEvidence: ["valid_consent_or_approved_alternative_basis"] };
}

const dsrTransitions: Readonly<Record<DataSubjectRequestStatus, readonly DataSubjectRequestStatus[]>> = {
  RECEIVED: ["IDENTITY_PENDING", "IN_REVIEW", "CANCELLED"],
  IDENTITY_PENDING: ["IN_REVIEW", "REJECTED", "CANCELLED"],
  IN_REVIEW: ["ACTION_REQUIRED", "BLOCKED", "COMPLETED", "REJECTED", "CANCELLED"],
  ACTION_REQUIRED: ["IN_REVIEW", "BLOCKED", "COMPLETED"],
  BLOCKED: ["IN_REVIEW", "REJECTED", "CANCELLED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionDsr(from: DataSubjectRequestStatus, to: DataSubjectRequestStatus): boolean {
  return dsrTransitions[from].includes(to);
}
