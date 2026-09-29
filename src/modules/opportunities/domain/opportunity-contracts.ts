import type { OpportunityStageCode } from "@/modules/opportunities/domain/opportunity-stage-policy";

export type OpportunityTransitionOption = Readonly<{
  stageId: string;
  code: OpportunityStageCode;
  name: string;
  allowed: boolean;
  blockReason: string | null;
  requiresConfirmation: boolean;
  requiresLossReason: boolean;
}>;

export type OpportunityListItem = Readonly<{
  id: string;
  leadId: string;
  leadName: string;
  accountId: string | null;
  accountName: string | null;
  ownerMemberId: string;
  ownerName: string;
  productId: string | null;
  productName: string | null;
  interestDescription: string | null;
  name: string;
  status: "OPEN" | "WON" | "LOST" | "CANCELLED";
  stageId: string;
  stageCode: OpportunityStageCode;
  stageName: string;
  stageEnteredAt: string;
  amountCents: string;
  mrrCents: string;
  tcvCents: string;
  probabilityPercent: number;
  expectedCloseAt: string | null;
  closedAt: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  lossReasonName: string | null;
  notes: string | null;
  revision: number;
  updatedAt: string;
  offers: readonly Readonly<{
    id: string;
    name: string;
    productName: string;
    totalCents: string;
    validUntil: string | null;
    acceptedAt: string | null;
    justification: string | null;
    createdAt: string;
  }>[];
  transitions: readonly OpportunityTransitionOption[];
  canWrite: boolean;
  canReopen: boolean;
}>;

export type OpportunityStageColumn = Readonly<{
  id: string;
  code: OpportunityStageCode;
  name: string;
  position: number;
  count: number;
  opportunities: readonly OpportunityListItem[];
}>;

export type OpportunityReference = Readonly<{ id: string; name: string }>;

export type OpportunityPipelineScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  filters: Readonly<{
    closerId: string;
    productId: string;
    stageCode: OpportunityStageCode | "ALL";
    from: string;
    to: string;
  }>;
  canWrite: boolean;
  canFilterCloser: boolean;
  closerOptions: readonly OpportunityReference[];
  productOptions: readonly OpportunityReference[];
  lossReasons: readonly OpportunityReference[];
  stages: readonly OpportunityStageColumn[];
}>;

export type LeadOpportunityScreen = Readonly<{
  leadId: string;
  leadName: string;
  timeZone: string;
  canRead: boolean;
  canCreate: boolean;
  accountOptions: readonly OpportunityReference[];
  suggestedAccountId: string | null;
  closerOptions: readonly OpportunityReference[];
  productOptions: readonly Readonly<{
    id: string;
    name: string;
    listPriceCents: string;
  }>[];
  offerTemplateOptions: readonly Readonly<{
    id: string;
    productId: string;
    name: string;
    priceCents: string;
    discountCents: string;
    validDays: number | null;
  }>[];
  meetingOptions: readonly Readonly<{
    id: string;
    title: string;
    status: "SCHEDULED" | "CONFIRMED" | "COMPLETED";
    ownerMemberId: string;
    startsAt: string;
  }>[];
  lossReasons: readonly OpportunityReference[];
  opportunities: readonly OpportunityListItem[];
}>;
