export type SettingsCatalogKind =
  | "LOSS_REASON"
  | "DISQUALIFICATION_REASON";

export type SettingsImpact = Readonly<{
  key: string;
  label: string;
  count: number;
}>;

export type SettingsPreview = Readonly<{
  title: string;
  summary: string;
  warnings: readonly string[];
  impacts: readonly SettingsImpact[];
}>;

export type CommercialSettingsScreen = Readonly<{
  workspace: Readonly<{
    id: string;
    name: string;
    timeZone: string;
    revision: number;
    pactoMinimumInvestigatedDimensions: number;
    defaultMeetingDurationMinutes: 30 | 40;
    distributionStrategy: "ROUND_ROBIN";
    maxOpenLeadsPerSdr: number | null;
    leadStagnationDays: number;
    leadWithoutActivityDays: number;
    cadenceTemplateKey: string;
    cadenceStopOnReply: boolean;
    cadenceStopOnMeetingScheduled: boolean;
    cadenceStopOnStageChange: boolean;
    cadenceDayOffsets: readonly number[];
    cadenceSteps: readonly Readonly<{
      dayOffset: number;
      action: "WHATSAPP" | "CALL" | "EMAIL" | "RECYCLE" | "CLOSE";
      timeOfDay: string;
      message: string;
      assigneeMemberId: string | null;
      targetStageId: string | null;
    }>[];
  }>;
  members: readonly Readonly<{ id: string; name: string }>[];
  cadenceTargetStages: readonly Readonly<{ id: string; name: string }>[];
  scoring: Readonly<{
    id: string;
    key: string;
    version: number;
    painMaxPoints: number;
    capacityMaxPoints: number;
    decisionMaxPoints: number;
    intentMaxPoints: number;
    contextMaxPoints: number;
    partialFactorBasisPoints: number;
    noCapacityPenalty: number;
    noPainPenalty: number;
    curiosityPenalty: number;
    invalidContactPenalty: number;
    noDecisionAccessPenalty: number;
    capacityFullThresholdCents: string;
    p1Minimum: number;
    p2Minimum: number;
    historicalCalculations: number;
  }> | null;
  slaBands: readonly Readonly<{
    id: string;
    code: "P1" | "P2" | "P3";
    name: string;
    position: number;
    scoreMin: number;
    scoreMax: number;
    leadPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    policyId: string;
    policyKey: string;
    policyVersion: number;
    policyName: string;
    firstResponseMinutes: number;
    healthyMaxSeconds: number;
    attentionMaxSeconds: number;
    historicalCycles: number;
  }>[];
  products: readonly Readonly<{
    id: string;
    catalogItemId: string;
    version: number;
    sku: string;
    name: string;
    description: string | null;
    listPriceCents: string;
    kind: "PRODUCT" | "MODULE" | "LINE" | "PLAN" | "LICENSE" | "IMPLEMENTATION" | "RECURRING_SERVICE" | "PROJECT";
    revenueCategory: "SOFTWARE" | "IMPLEMENTATION" | "RECURRING_SERVICE" | "PROJECT";
    audience: "INSTITUTIONAL" | "INDIVIDUAL" | "GOVERNMENT";
    availability: "DRAFT" | "AVAILABLE" | "CAPACITY_LIMITED" | "FUTURE" | "RETIRED";
    capacityUnits: number | null;
    approvedConditions: string;
    salesGateProfile: "STANDARD" | "MANDATO";
    active: boolean;
    updatedAt: string;
    opportunitiesInUse: number;
    offersInUse: number;
  }>[];
  offerTemplates: readonly Readonly<{
    id: string;
    catalogTemplateId: string;
    version: number;
    productId: string;
    productName: string;
    key: string;
    name: string;
    description: string | null;
    priceCents: string;
    discountCents: string;
    validDays: number | null;
    active: boolean;
    availability: "DRAFT" | "AVAILABLE" | "CAPACITY_LIMITED" | "FUTURE" | "RETIRED";
    approvedConditions: string;
    components: readonly Readonly<{ productId: string; productName: string; revenueCategory: "SOFTWARE" | "IMPLEMENTATION" | "RECURRING_SERVICE" | "PROJECT"; position: number; quantity: number; unitPriceCents: string; discountCents: string }>[];
    updatedAt: string;
    offersInUse: number;
  }>[];
  lossReasons: readonly Readonly<{
    id: string;
    key: string;
    name: string;
    position: number;
    active: boolean;
    updatedAt: string;
    recordsInUse: number;
  }>[];
  disqualificationReasons: readonly Readonly<{
    id: string;
    key: string;
    name: string;
    position: number;
    active: boolean;
    updatedAt: string;
    recordsInUse: number;
  }>[];
  pipelines: readonly Readonly<{
    id: string;
    name: string;
    entityType: "LEAD" | "OPPORTUNITY";
    isDefault: boolean;
    updatedAt: string;
    stages: readonly Readonly<{
      id: string;
      name: string;
      position: number;
      type: "OPEN" | "WON" | "LOST";
      code: string;
      currentRecords: number;
      historyRecords: number;
    }>[];
    transitions: readonly Readonly<{
      id: string;
      fromStageId: string;
      fromName: string;
      toStageId: string;
      toName: string;
      active: boolean;
    }>[];
  }>[];
}>;
