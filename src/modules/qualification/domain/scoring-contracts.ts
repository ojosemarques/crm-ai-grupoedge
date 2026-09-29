export const scoringRuleKey = "pacto-default";
export const scoringAlgorithmKey = "pacto-weighted-v1";

export const scoreSourceLabels = {
  FORM_PROVISIONAL: "Provisória do formulário",
  SDR_VALIDATED: "Validada pelo SDR",
  AI_SUGGESTED: "Sugerida pela IA",
  HUMAN_OVERRIDE: "Override humano",
} as const;

export type ScoreSourceKey = keyof typeof scoreSourceLabels;
export type PriorityBandKey = "P1" | "P2" | "P3";

export type ScoringRule = Readonly<{
  id: string;
  key: string;
  version: number;
  algorithmKey: string;
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
  capacityFullThresholdCents: bigint;
  p1Minimum: number;
  p2Minimum: number;
}>;

export type ScoreFactorKey =
  | "PAIN"
  | "CAPACITY"
  | "DECISION"
  | "INTENT"
  | "CONTEXT"
  | "NO_CAPACITY"
  | "NO_PAIN"
  | "CURIOSITY"
  | "INVALID_CONTACT"
  | "NO_DECISION_ACCESS"
  | "HUMAN_OVERRIDE"
  | "AI_SUGGESTION";

export type ScoreComponent = Readonly<{
  factor: ScoreFactorKey;
  points: number;
  maxPoints: number;
  reason: string;
  missingData: boolean;
  evidence?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ScoreCalculation = Readonly<{
  score: number;
  priorityBandCode: PriorityBandKey;
  reason: string;
  components: readonly ScoreComponent[];
}>;

export type LeadScoreView = Readonly<{
  leadId: string;
  generatedAt: string;
  timeZone: string;
  revision: number;
  canWrite: boolean;
  current: Readonly<{
    id: string;
    score: number;
    priorityBandCode: PriorityBandKey;
    source: ScoreSourceKey;
    sourceLabel: string;
    reason: string;
    overrideReason: string | null;
    rule: Readonly<{ key: string; version: number; algorithmKey: string }> | null;
    calculatedBy: string;
    calculatedAt: string;
    components: readonly ScoreComponent[];
  }> | null;
  suggestions: readonly Readonly<{
    id: string;
    score: number;
    priorityBandCode: PriorityBandKey;
    source: "AI_SUGGESTED";
    reason: string;
    calculatedBy: string;
    calculatedAt: string;
    components: readonly ScoreComponent[];
  }>[];
  history: readonly Readonly<{
    id: string;
    score: number;
    priorityBandCode: PriorityBandKey;
    source: ScoreSourceKey;
    sourceLabel: string;
    reason: string;
    overrideReason: string | null;
    currentRevision: number | null;
    ruleVersion: number | null;
    calculatedBy: string;
    calculatedAt: string;
  }>[];
}>;
