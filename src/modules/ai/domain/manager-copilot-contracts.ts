import type { ManagerAnalyticsAnswer } from "@/modules/metrics/domain/manager-analytics-contracts";

export type ManagerCopilotResult = Readonly<{
  answer: ManagerAnalyticsAnswer;
  trace: Readonly<{
    insightId: string;
    status: "OPEN" | "ACCEPTED" | "REJECTED";
    promptKey: string;
    promptVersion: number;
    providerKey: string;
    mode: "LOCAL_DETERMINISTIC" | "EXTERNAL" | "FALLBACK_LOCAL";
    providerFailureCode: string | null;
    confidence: number;
    persistedAt: string;
  }>;
}>;

export type ManagerCopilotConfirmation = Readonly<{
  insightId: string;
  status: "ACCEPTED" | "REJECTED";
  confirmedAt: string;
  message: string;
}>;
