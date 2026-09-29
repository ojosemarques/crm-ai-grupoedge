import { z } from "zod";

import type { AIAgentType } from "@/modules/ai/domain/ai-contracts";

export const aiUseCaseKeys = [
  "operational-summary",
  "next-best-action",
  "internal-classification",
  "metric-synthesis",
] as const;

export const aiUseCaseKeySchema = z.enum(aiUseCaseKeys);
export type AIUseCaseKey = z.infer<typeof aiUseCaseKeySchema>;

export const agentUseCaseMap: Readonly<Record<AIAgentType, AIUseCaseKey>> = Object.freeze({
  QUALIFICATION: "internal-classification",
  CALL_PREPARATION: "operational-summary",
  CONVERSATION_EXTRACTION: "internal-classification",
  NEXT_BEST_ACTION: "next-best-action",
  MANAGER_COPILOT: "metric-synthesis",
  AUDIT_AGENT: "operational-summary",
});

export const governanceTransitionSchema = z.object({
  useCaseVersionId: z.string().uuid(),
  action: z.enum(["EVALUATE", "APPROVE", "DISABLE", "ROLLBACK"]),
  reason: z.string().trim().min(3).max(500),
  rollbackTargetVersionId: z.string().uuid().optional(),
}).strict();

export const humanDecisionInputSchema = z.object({
  executionTraceId: z.string().uuid(),
  insightId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(180),
  decision: z.enum(["ACCEPTED", "EDITED", "REJECTED"]),
  reason: z.string().trim().min(3).max(500),
  currentInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  proposedDraft: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const initialAIUseCaseDefinitions = Object.freeze([
  {
    key: "operational-summary",
    name: "Resumo operacional",
    description: "Sintetiza fatos já autorizados para preparar atendimento; não altera registros.",
    riskLevel: "LOW",
    agentType: "CALL_PREPARATION",
    promptKey: "politizai.call-preparation",
    promptVersion: 2,
    allowedInputFields: ["facts", "requiredFields", "pacto", "currentState"],
  },
  {
    key: "next-best-action",
    name: "Próxima melhor ação",
    description: "Sugere uma ação revisável com motivo, evidência, confiança e limitações.",
    riskLevel: "MEDIUM",
    agentType: "NEXT_BEST_ACTION",
    promptKey: "politizai.next-best-action",
    promptVersion: 2,
    allowedInputFields: ["facts", "requiredFields", "pacto", "currentState"],
  },
  {
    key: "internal-classification",
    name: "Classificação interna não sensível",
    description: "Extrai sinais e campos faltantes para rascunho humano; não publica score ou PACTO.",
    riskLevel: "MEDIUM",
    agentType: "QUALIFICATION",
    promptKey: "politizai.qualification",
    promptVersion: 2,
    allowedInputFields: ["facts", "requiredFields", "scoreSignals", "pacto", "currentState", "textExcerpt"],
  },
  {
    key: "metric-synthesis",
    name: "Síntese gerencial de métricas",
    description: "Resume métricas calculadas e registros autorizados, sem inferir causalidade.",
    riskLevel: "LOW",
    agentType: "MANAGER_COPILOT",
    promptKey: "politizai.manager-copilot",
    promptVersion: 2,
    allowedInputFields: ["facts", "requiredFields", "currentState"],
  },
] as const);

export const forbiddenAIInputFields = Object.freeze([
  "email",
  "phone",
  "telefone",
  "document",
  "cpf",
  "cnpj",
  "password",
  "senha",
  "secret",
  "token",
  "cookie",
  "authorization",
]);

export const defaultAIExecutionLimits = Object.freeze({
  timeoutMs: 5_000,
  maxRetries: 0,
  rateLimitPerMinute: 30,
  maxInputTokens: 4_000,
  maxOutputTokens: 2_000,
  maxEstimatedCostCents: 0,
  confidenceThresholdBps: 5_000,
});
