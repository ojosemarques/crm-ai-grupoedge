export type LifecycleTarget = Readonly<{
  entityType: "CONTACT" | "ACCOUNT";
  entityId: string;
}>;

export type OwnershipTarget = Readonly<{
  entityType: "CONTACT" | "ACCOUNT" | "LEAD" | "OPPORTUNITY";
  entityId: string;
}>;

export type JourneySnapshot = Readonly<{
  target: LifecycleTarget;
  lifecycle: Readonly<{
    stage: string;
    currentSince: string;
    source: string;
    evidenceQuality: string;
    ruleKey: string;
    ruleVersion: number;
    revision: number;
  }> | null;
  ownership: readonly Readonly<{
    id: string;
    function: string;
    destinationType: "MEMBER" | "QUEUE";
    destinationId: string;
    destinationName: string;
    validFrom: string;
  }>[];
  pendingTransfers: readonly Readonly<{
    id: string;
    fromFunction: string;
    toFunction: string;
    destinationName: string;
    reason: string;
    dueAt: string | null;
  }>[];
  missingRequiredOwner: string | null;
}>;
