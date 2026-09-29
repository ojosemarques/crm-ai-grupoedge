export const pactoDimensions = [
  "POLITICAL_CONTEXT",
  "AFFLICTION",
  "CAPACITY",
  "DECISION",
  "OPPORTUNITY_NOW",
] as const;

export type PactoDimensionKey = (typeof pactoDimensions)[number];

export const pactoStatuses = [
  "UNKNOWN",
  "POSITIVE",
  "PARTIAL",
  "NEGATIVE",
  "DISQUALIFYING",
] as const;

export type PactoStatusKey = (typeof pactoStatuses)[number];

export const qualificationEvidenceOrigins = ["FORM", "SDR", "CLOSER", "AI"] as const;
export type QualificationEvidenceOriginKey =
  (typeof qualificationEvidenceOrigins)[number];

export const pactoDimensionLabels: Readonly<Record<PactoDimensionKey, string>> = {
  POLITICAL_CONTEXT: "P — Político / contexto",
  AFFLICTION: "A — Aflição",
  CAPACITY: "C — Capacidade",
  DECISION: "T — Tomada de decisão",
  OPPORTUNITY_NOW: "O — Oportunidade agora",
};

export const pactoDimensionGuidance: Readonly<Record<PactoDimensionKey, string>> = {
  POLITICAL_CONTEXT: "Entenda o contexto político, institucional ou operacional que torna a solução relevante.",
  AFFLICTION: "Registre a dor nas palavras do lead e o impacto percebido, sem completar lacunas por suposição.",
  CAPACITY: "Investigue compatibilidade e perspectiva de investimento com respeito, sem interrogatório financeiro.",
  DECISION: "Identifique quem decide, quem influencia e como a decisão costuma acontecer.",
  OPPORTUNITY_NOW: "Valide urgência, janela de decisão e por que agir agora — ou por que ainda não.",
};

export const pactoStatusLabels: Readonly<Record<PactoStatusKey, string>> = {
  UNKNOWN: "Não investigado",
  POSITIVE: "Favorável",
  PARTIAL: "Parcial",
  NEGATIVE: "Desfavorável",
  DISQUALIFYING: "Desqualificante",
};

export type PactoDimensionInput = Readonly<{
  dimension: PactoDimensionKey;
  status: PactoStatusKey;
  note?: string | null;
  evidence?: string | null;
  origin?: QualificationEvidenceOriginKey | null;
}>;

export type PactoDimensionView = Readonly<{
  dimension: PactoDimensionKey;
  label: string;
  guidance: string;
  status: PactoStatusKey;
  note: string | null;
  evidence: string | null;
  origin: string | null;
  recordedAt: string | null;
  recordedBy: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
}>;

export type PactoSuggestionView = Readonly<{
  id: string;
  dimension: PactoDimensionKey;
  label: string;
  status: PactoStatusKey;
  note: string | null;
  evidence: string;
  origin: "FORM" | "AI";
  createdBy: string;
  createdAt: string;
}>;

export type PactoRevisionView = Readonly<{
  id: string;
  revisionNumber: number;
  kind: "DRAFT_SAVED" | "VALIDATED";
  qualificationStatus: string;
  minimumRequiredDimensions: number;
  investigatedDimensions: number;
  hasDisqualifyingDimension: boolean;
  isQualificationReady: boolean;
  createdBy: string;
  createdAt: string;
  dimensions: readonly PactoDimensionView[];
}>;

export type PactoQualificationView = Readonly<{
  leadId: string;
  generatedAt: string;
  timeZone: string;
  revision: number;
  aggregateStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  minimumRequiredDimensions: number;
  investigatedDimensions: number;
  missingDimensions: readonly PactoDimensionKey[];
  hasDisqualifyingDimension: boolean;
  isQualificationReady: boolean;
  validatedAt: string | null;
  validatedBy: string | null;
  canWrite: boolean;
  dimensions: readonly PactoDimensionView[];
  formPrequalification: readonly PactoSuggestionView[];
  aiSuggestions: readonly PactoSuggestionView[];
  history: readonly PactoRevisionView[];
}>;
