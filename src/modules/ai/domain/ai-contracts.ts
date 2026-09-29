import { z } from "zod";

export const aiAgentTypes = [
  "QUALIFICATION",
  "CALL_PREPARATION",
  "CONVERSATION_EXTRACTION",
  "NEXT_BEST_ACTION",
  "MANAGER_COPILOT",
  "AUDIT_AGENT",
] as const;

export const aiAgentTypeSchema = z.enum(aiAgentTypes);
export type AIAgentType = z.infer<typeof aiAgentTypeSchema>;

const compactText = (maximum: number) => z.string().trim().min(1).max(maximum);
const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_.-]*$/i, "Use uma chave de campo estável.");

export const aiInputFactSchema = z
  .object({
    field: fieldKeySchema,
    value: compactText(2_000),
    source: z.enum(["FORM", "CRM", "ACTIVITY", "MEETING", "METRIC", "HUMAN"]),
    evidence: compactText(2_000).optional(),
  })
  .strict();

const signalSchema = z.enum(["UNKNOWN", "PARTIAL", "POSITIVE", "NEGATIVE"]);

export const aiAnalysisInputSchema = z
  .object({
    facts: z.array(aiInputFactSchema).max(100).default([]),
    requiredFields: z.array(fieldKeySchema).max(50).default([]),
    scoreSignals: z
      .object({
        pain: signalSchema.optional(),
        capacity: signalSchema.optional(),
        decision: signalSchema.optional(),
        intent: signalSchema.optional(),
        context: signalSchema.optional(),
      })
      .strict()
      .optional(),
    pacto: z
      .array(
        z
          .object({
            dimension: z.enum(["P", "A", "C", "T", "O"]),
            status: z.enum([
              "NOT_INVESTIGATED",
              "FAVORABLE",
              "PARTIAL",
              "UNFAVORABLE",
              "DISQUALIFYING",
            ]),
            evidence: compactText(2_000).optional(),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    currentState: z
      .object({
        stage: compactText(120).optional(),
        priority: z.enum(["P1", "P2", "P3"]).optional(),
        score: z.number().int().min(0).max(100).optional(),
        nextAction: compactText(500).optional(),
        nextActionDueAt: z.string().datetime({ offset: true }).optional(),
        awaitingHumanResponse: z.boolean().optional(),
        hasHumanAttempt: z.boolean().optional(),
        doNotContact: z.boolean().optional(),
      })
      .strict()
      .default({}),
    textExcerpt: compactText(12_000).optional(),
  })
  .strict();

export type AIAnalysisInput = z.output<typeof aiAnalysisInputSchema>;

const outputFactSchema = z
  .object({
    statement: compactText(2_000),
    source: compactText(120),
    evidence: compactText(2_000).nullable(),
  })
  .strict();

const inferenceSchema = z
  .object({
    statement: compactText(2_000),
    basis: compactText(2_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const evidenceSchema = z
  .object({
    id: compactText(100),
    statement: compactText(2_000),
    source: compactText(120),
  })
  .strict();

const pactoOutputSchema = z
  .object({
    dimension: z.enum(["P", "A", "C", "T", "O"]),
    status: z.enum([
      "NOT_INVESTIGATED",
      "FAVORABLE",
      "PARTIAL",
      "UNFAVORABLE",
      "DISQUALIFYING",
    ]),
    evidenceIds: z.array(compactText(100)).max(20),
  })
  .strict();

const scoreSchema = z
  .object({
    value: z.number().int().min(0).max(100),
    reason: compactText(2_000),
    components: z
      .array(
        z
          .object({
            factor: z.enum(["PAIN", "CAPACITY", "DECISION", "INTENT", "CONTEXT"]),
            points: z.number().int().min(0).max(100),
            maxPoints: z.number().int().min(0).max(100),
            reason: compactText(500),
            missingData: z.boolean(),
          })
          .strict(),
      )
      .length(5),
  })
  .strict();

const actionSchema = z
  .object({
    title: compactText(500),
    reason: compactText(2_000),
    requiresConfirmation: z.literal(true),
    message: compactText(2_000).nullable(),
  })
  .strict();

const commonOutputShape = {
  summary: compactText(4_000),
  facts: z.array(outputFactSchema).max(100),
  inferences: z.array(inferenceSchema).max(50),
  missingFields: z.array(fieldKeySchema).max(50),
  evidence: z.array(evidenceSchema).max(100),
  pacto: z.array(pactoOutputSchema).max(5),
  questions: z.array(compactText(1_000)).max(20),
  score: scoreSchema.nullable(),
  priority: z.enum(["P1", "P2", "P3"]).nullable(),
  action: actionSchema.nullable(),
  alternativeAction: actionSchema.nullable(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "IMMEDIATE"]),
  confidence: z.number().min(0).max(1),
  risks: z.array(compactText(1_000)).max(20),
} as const;

function contractFor<TAgent extends AIAgentType>(agent: TAgent) {
  return z.object({ agent: z.literal(agent), ...commonOutputShape }).strict();
}

export const qualificationOutputSchema = contractFor("QUALIFICATION");
export const callPreparationOutputSchema = contractFor("CALL_PREPARATION");
export const conversationExtractionOutputSchema = contractFor("CONVERSATION_EXTRACTION");
export const nextBestActionOutputSchema = contractFor("NEXT_BEST_ACTION");
export const managerCopilotOutputSchema = contractFor("MANAGER_COPILOT");
export const auditAgentOutputSchema = contractFor("AUDIT_AGENT");

export const aiOutputSchemas = Object.freeze({
  QUALIFICATION: qualificationOutputSchema,
  CALL_PREPARATION: callPreparationOutputSchema,
  CONVERSATION_EXTRACTION: conversationExtractionOutputSchema,
  NEXT_BEST_ACTION: nextBestActionOutputSchema,
  MANAGER_COPILOT: managerCopilotOutputSchema,
  AUDIT_AGENT: auditAgentOutputSchema,
});

export type AIValidatedOutput =
  | z.infer<typeof qualificationOutputSchema>
  | z.infer<typeof callPreparationOutputSchema>
  | z.infer<typeof conversationExtractionOutputSchema>
  | z.infer<typeof nextBestActionOutputSchema>
  | z.infer<typeof managerCopilotOutputSchema>
  | z.infer<typeof auditAgentOutputSchema>;

export function parseAIOutput(
  agent: AIAgentType,
  value: unknown,
): AIValidatedOutput {
  return aiOutputSchemas[agent].parse(value) as AIValidatedOutput;
}
