import type { AIValidatedOutput } from "@/modules/ai/domain/ai-contracts";

export const leadIntelligenceUseCases = [
  "LEAD_ANALYSIS",
  "CALL_PREPARATION",
  "CONVERSATION_EXTRACTION",
  "NEXT_BEST_ACTION",
] as const;

export type LeadIntelligenceUseCase = (typeof leadIntelligenceUseCases)[number];

export type TaskIntelligenceProposal = Readonly<{
  id: "task";
  target: "TASK";
  label: string;
  currentValue: Readonly<{ title: string; dueAt: string }> | null;
  suggestedValue: Readonly<{
    title: string;
    dueAt: string;
    kind: "FOLLOW_UP";
    priority: "MEDIUM" | "HIGH" | "URGENT";
    message: string | null;
  }>;
}>;

export type ScoreIntelligenceProposal = Readonly<{
  id: "score";
  target: "SCORE";
  label: string;
  currentValue: Readonly<{
    score: number;
    priority: "P1" | "P2" | "P3";
    revision: number;
  }> | null;
  suggestedValue: Readonly<{
    score: number;
    priority: "P1" | "P2" | "P3";
    reason: string;
  }>;
}>;

export type PactoIntelligenceProposal = Readonly<{
  id: `pacto:${string}`;
  target: "PACTO";
  dimension: string;
  label: string;
  currentValue: Readonly<{
    status: string;
    evidence: string | null;
  }>;
  suggestedValue: Readonly<{
    status: string;
    evidence: string;
    note: string | null;
  }>;
}>;

export type LeadIntelligenceProposal =
  | TaskIntelligenceProposal
  | ScoreIntelligenceProposal
  | PactoIntelligenceProposal;

export type LeadIntelligenceReview = Readonly<{
  decision: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED";
  reason: string | null;
  selectedProposalIds: readonly string[];
  editedProposalIds: readonly string[];
  reviewedBy: string;
  reviewedAt: string;
}>;

export type LeadIntelligenceInsight = Readonly<{
  id: string;
  useCase: LeadIntelligenceUseCase;
  agent: AIValidatedOutput["agent"];
  title: string;
  status: "OPEN" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "EXECUTED";
  prompt: Readonly<{ key: string; version: number }>;
  provider: Readonly<{
    requestedKey: string;
    key: string;
    mode: "LOCAL_DETERMINISTIC" | "EXTERNAL" | "FALLBACK_LOCAL";
    failureCode: string | null;
  }>;
  output: AIValidatedOutput;
  proposals: readonly LeadIntelligenceProposal[];
  requestedBy: string;
  createdAt: string;
  review: LeadIntelligenceReview | null;
}>;

export type LeadIntelligenceScreen = Readonly<{
  leadId: string;
  generatedAt: string;
  timeZone: string;
  modeNotice: string;
  doNotContact: boolean;
  permissions: Readonly<{
    canUse: boolean;
    canApplyPacto: boolean;
    canApplyScore: boolean;
    canCreateTask: boolean;
  }>;
  insights: readonly LeadIntelligenceInsight[];
}>;
