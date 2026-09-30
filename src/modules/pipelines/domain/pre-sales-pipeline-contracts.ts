export const leadStageCodes = [
  "NEW",
  "TRYING_CONTACT",
  "CONNECTED",
  "IN_QUALIFICATION",
  "QUALIFIED",
  "MEETING_SCHEDULED",
  "NURTURING",
  "DISQUALIFIED",
] as const;

export type LeadStageCode = (typeof leadStageCodes)[number];

export const leadStageLabels: Readonly<Record<LeadStageCode, string>> = {
  NEW: "Novo",
  TRYING_CONTACT: "Tentando contato",
  CONNECTED: "Conectado",
  IN_QUALIFICATION: "Em qualificação",
  QUALIFIED: "Qualificado",
  MEETING_SCHEDULED: "Reunião agendada",
  NURTURING: "Nutrição",
  DISQUALIFIED: "Desqualificado",
};

export type StageTransitionOption = Readonly<{
  stageId: string;
  code: LeadStageCode;
  name: string;
  allowed: boolean;
  correctionAllowed: boolean;
  blockReason: string | null;
  correctionBlockReason: string | null;
  requiresConfirmation: boolean;
  requiresDisqualificationReason: boolean;
}>;

export type LeadPipelineCard = Readonly<{
  id: string;
  fullName: string;
  jobTitle: string | null;
  priorityCode: "P1" | "P2" | "P3" | null;
  score: number | null;
  responsibleName: string;
  currentStageName: string;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  pactoReady: boolean;
}>;

export type LeadPipelineStageColumn = Readonly<{
  id: string;
  code: LeadStageCode;
  name: string;
  position: number;
  count: number;
  displayedCount: number;
  leads: readonly LeadPipelineCard[];
}>;

export type LeadPipelineState = Readonly<{
  leadId: string;
  currentStageId: string;
  currentStageCode: LeadStageCode;
  currentStageName: string;
  stageEnteredAt: string;
  updatedAt: string;
  hasNextAction: boolean;
  pactoReady: boolean;
  canWrite: boolean;
  canCorrect: boolean;
  disqualificationReasons: readonly Readonly<{ id: string; name: string }>[];
  transitions: readonly StageTransitionOption[];
}>;

export type PreSalesPipelineScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  pipelineId: string;
  pipelineName: string;
  cardLimitPerStage: number;
  filters: Readonly<{
    pipelineId: string;
    q: string;
    responsible: string;
    priority: "ALL" | "P1" | "P2" | "P3";
    stageCode: "ALL" | LeadStageCode;
  }>;
  responsibleOptions: readonly Readonly<{ value: string; label: string }>[];
  stages: readonly LeadPipelineStageColumn[];
  canWrite: boolean;
  canCorrect: boolean;
}>;
