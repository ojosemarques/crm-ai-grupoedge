export const contractStatuses = [
  "DRAFT", "INTERNAL_REVIEW", "READY_TO_SEND", "SENT_SIMULATED",
  "ACCEPTED", "REJECTED", "VOIDED", "SUPERSEDED", "EXPIRED",
] as const;
export type ContractStatus = (typeof contractStatuses)[number];

export type ContractScreenItem = Readonly<{
  id: string;
  contractNumber: string;
  opportunityId: string;
  opportunityName: string;
  accountName: string;
  contactName: string;
  ownerName: string;
  status: ContractStatus;
  revision: number;
  currentVersion: null | Readonly<{
    id: string;
    versionNumber: number;
    state: "DRAFT" | "ISSUED" | "SUPERSEDED";
    totalCents: string;
    mrrCents: string;
    tcvCents: string;
    proposedStartsAt: string | null;
    proposedEndsAt: string | null;
    contentHash: string | null;
    renderedHtml: string | null;
  }>;
  versionCount: number;
  acceptedAt: string | null;
  effectiveStartsAt: string | null;
  effectiveEndsAt: string | null;
  reconciliation: readonly string[];
  canIssue: boolean;
  canSendSimulate: boolean;
  canAccept: boolean;
  canReject: boolean;
  canVoid: boolean;
  canVersion: boolean;
}>;

export type ContractScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  filters: Readonly<{ search: string; status: ContractStatus | "ALL" }>;
  metrics: Readonly<{
    drafts: number;
    awaitingAcceptance: number;
    accepted: number;
    expiringSoon: number;
    divergences: number;
    acceptanceRate: number | null;
    averageVersions: number | null;
  }>;
  canCreate: boolean;
  eligibleOpportunities: readonly Readonly<{
    id: string;
    name: string;
    accountName: string;
    contactName: string;
    offerId: string;
    offerName: string;
    totalCents: string;
  }>[];
  templateVersions: readonly Readonly<{ id: string; name: string; version: number; legalReviewState: string }>[];
  items: readonly ContractScreenItem[];
}>;
