import { z } from "zod";

export const agentDefinitionSchema = z.object({
  instructions: z.string().trim().min(20).max(12_000),
  tone: z.enum(["CONSULTATIVE", "DIRECT", "EMPATHETIC"]),
  audience: z.string().trim().min(2).max(300),
  offerScope: z.string().trim().min(2).max(500),
  model: z.literal("local-deterministic-v1"),
  budgetCents: z.number().int().min(0).max(10_000),
  maxInputTokens: z.number().int().min(100).max(8_000),
  maxOutputTokens: z.number().int().min(50).max(2_000),
  allowedDataFields: z.array(z.enum(["lead.name", "lead.lifecycle", "opportunity.stage", "conversation.messages", "catalog.active_products"])).max(5),
  allowedTools: z.array(z.enum(["SEARCH_APPROVED_KB", "PROPOSE_FIELDS", "REQUEST_HANDOFF", "PROPOSE_SENSITIVE_ACTION"])).max(4),
  knowledge: z.object({ title: z.string().trim().min(2).max(200), content: z.string().trim().min(20).max(50_000), sourceReference: z.string().trim().min(3).max(500) }).strict(),
}).strict();

const base = z.object({ name: z.string().trim().min(3).max(120), objective: z.string().trim().min(10).max(1_000) }).strict();
export const governedAgentCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_AGENT"), payload: base.extend({ definition: agentDefinitionSchema }) }).strict(),
  z.object({ action: z.literal("SAVE_DRAFT"), payload: base.extend({ agentId: z.string().uuid(), expectedRevision: z.number().int().positive(), definition: agentDefinitionSchema }) }).strict(),
  z.object({ action: z.literal("EVALUATE"), payload: z.object({ agentId: z.string().uuid() }).strict() }).strict(),
  z.object({ action: z.literal("PUBLISH"), payload: z.object({ agentId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict() }).strict(),
  z.object({ action: z.literal("PAUSE"), payload: z.object({ agentId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict() }).strict(),
  z.object({ action: z.literal("ROLLBACK"), payload: z.object({ agentId: z.string().uuid(), targetVersionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict() }).strict(),
  z.object({ action: z.literal("SIMULATE"), payload: z.object({ agentId: z.string().uuid(), message: z.string().trim().min(1).max(4_000) }).strict() }).strict(),
  z.object({ action: z.literal("START_CONVERSATION"), payload: z.object({ agentId: z.string().uuid(), conversationId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(180), message: z.string().trim().min(1).max(4_000) }).strict() }).strict(),
  z.object({ action: z.literal("HUMAN_REPLY"), payload: z.object({ conversationId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict() }).strict(),
  z.object({ action: z.literal("RESUME"), payload: z.object({ conversationId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(180) }).strict() }).strict(),
  z.object({ action: z.literal("APPROVE_SENSITIVE"), payload: z.object({ turnId: z.string().uuid(), decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().min(3).max(500) }).strict() }).strict(),
]);

export const internalSubagents = Object.freeze([
  ["account-research", "Pesquisa de conta"], ["diagnosis", "Diagnóstico"], ["briefing", "Briefing"],
  ["solution", "Solução"], ["proposal", "Proposta"], ["risk", "Risco"], ["follow-up", "Follow-up"],
  ["handoff", "Handoff"], ["customer-success", "Customer Success"], ["analysis", "Análise"],
].map(([key, name]) => ({ key, name, status: "DRAFT" as const, specialty: name })));
