export type ContactPointView = Readonly<{
  id: string;
  type: "PHONE" | "EMAIL" | "WHATSAPP" | "INSTAGRAM";
  value: string;
  normalizedValue: string;
  label: string | null;
  isPrimary: boolean;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "INVALID";
  quality: "UNKNOWN" | "VALID" | "SUSPECT" | "INVALID";
  doNotContact: boolean;
  source: "LEAD_INTAKE" | "LEAD_BACKFILL" | "MANUAL";
}>;

export type ContactIdentityReviewView = Readonly<{
  id: string;
  reason: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  divergenceFields: readonly string[];
  candidateContactId: string | null;
  evidence: unknown;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}>;

export type LeadContactView = Readonly<{
  leadId: string;
  canResolveReviews: boolean;
  contact: Readonly<{
    id: string;
    preferredName: string;
    legalName: string | null;
    jobTitle: string | null;
    status: "ACTIVE" | "MERGED" | "INACTIVE";
    quality: "UNKNOWN" | "CONFIRMED" | "NEEDS_REVIEW";
    origin: "LEAD_INTAKE" | "LEAD_BACKFILL" | "MANUAL";
    points: readonly ContactPointView[];
  }> | null;
  openReviews: readonly ContactIdentityReviewView[];
  legacyIdentityPreserved: true;
}>;

export type ContactBackfillRunView = Readonly<{
  id: string;
  runKey: string;
  ruleVersion: string;
  mode: "DRY_RUN" | "EXECUTE";
  status: "PENDING" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED";
  batchSize: number;
  cursorLeadId: string | null;
  eligibleCount: number;
  processedCount: number;
  contactsCreated: number;
  pointsCreated: number;
  leadsLinked: number;
  reviewsOpened: number;
  ignoredCount: number;
  failedCount: number;
  startedAt: string | null;
  pausedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}>;
