import { z } from "zod";

export const N8N_CONTRACT_VERSION = "1.0" as const;
export const N8N_LABEL = "Sandbox local — n8n não conectado" as const;
export const N8N_MAX_BODY_BYTES = 64 * 1024;
export const N8N_SIGNATURE_TOLERANCE_SECONDS = 300;
export const N8N_MAX_CAUSATION_DEPTH = 4;
export const N8N_MAX_PAGE_SIZE = 50;

export const n8nMachineScopeSchema = z.enum([
  "EVENTS_READ",
  "RECORDS_READ",
  "ACTIVITY_DRAFT_CREATE",
  "NEXT_ACTION_DRAFT_CREATE",
  "AUTOMATION_RESULT_WRITE",
  "ACTION_PROPOSAL_CREATE",
]);

export type N8nMachineScopeValue = z.infer<typeof n8nMachineScopeSchema>;

export const n8nEventTypes = [
  "lead.assigned",
  "lead.sla_overdue",
  "lead.followup_overdue",
  "lead.stage_changed",
  "meeting.scheduled",
  "meeting.cancelled",
  "opportunity.won",
  "opportunity.lost",
  "onboarding.blocked",
  "renewal.risk_detected",
  "churn.risk_detected",
  "customer_service.critical_request",
  "ai.suggestion_accepted",
  "ai.suggestion_rejected",
] as const;

export const n8nEventTypeSchema = z.enum(n8nEventTypes);

export const n8nRecipeCatalog = [
  { key: "lead-assigned", name: "Lead atribuído", trigger: "lead.assigned", action: "Criar rascunho de atividade", confirmation: false },
  { key: "sla-or-followup-overdue", name: "SLA ou retorno vencido", trigger: "lead.sla_overdue", action: "Propor próxima ação", confirmation: true },
  { key: "stage-changed", name: "Etapa alterada", trigger: "lead.stage_changed", action: "Registrar resultado da automação", confirmation: false },
  { key: "meeting-scheduled-cancelled", name: "Reunião agendada ou cancelada", trigger: "meeting.scheduled", action: "Propor acompanhamento", confirmation: true },
  { key: "opportunity-won-lost", name: "Oportunidade ganha ou perdida", trigger: "opportunity.won", action: "Registrar resultado", confirmation: false },
  { key: "onboarding-blocked", name: "Onboarding bloqueado", trigger: "onboarding.blocked", action: "Propor ação consequencial", confirmation: true },
  { key: "renewal-churn-risk", name: "Risco de renovação ou churn", trigger: "renewal.risk_detected", action: "Propor ação consequencial", confirmation: true },
  { key: "critical-service-request", name: "Solicitação crítica de CS", trigger: "customer_service.critical_request", action: "Propor próxima ação", confirmation: true },
  { key: "ai-suggestion-decided", name: "Sugestão de IA aceita ou rejeitada", trigger: "ai.suggestion_accepted", action: "Registrar decisão", confirmation: false },
] as const;

const keySchema = z.string().trim().regex(/^[a-z][a-z0-9-]{2,63}$/);
const correlationSchema = z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,120}$/);
const idempotencySchema = z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,160}$/);

export const createN8nMachineSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(3).max(100),
  purpose: z.string().trim().min(12).max(500),
  ownerMemberId: z.string().uuid(),
  scopes: z.array(n8nMachineScopeSchema).min(1).max(6).refine((value) => new Set(value).size === value.length, "Escopos duplicados."),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const rotateN8nMachineSchema = z.object({
  machineId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export const setN8nMachineStatusSchema = z.object({
  machineId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["ACTIVE", "PAUSED", "REVOKED"]),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const setN8nMachineScopesSchema = z.object({
  machineId: z.string().uuid(),
  revision: z.number().int().positive(),
  scopes: z.array(n8nMachineScopeSchema).min(1).max(6).refine((value) => new Set(value).size === value.length, "Escopos duplicados."),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const createN8nRecipeSchema = z.object({
  catalogKey: z.enum(n8nRecipeCatalog.map((item) => item.key) as [string, ...string[]]),
  ownerMemberId: z.string().uuid(),
}).strict();

export const setN8nRecipeStatusSchema = z.object({
  recipeId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["ACTIVE", "PAUSED", "REVOKED"]),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const reviewN8nProposalSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const n8nCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DRAFT_ACTIVITY"), targetType: z.literal("LEAD"), targetId: z.string().uuid(), reason: z.string().trim().min(8).max(500), activityType: z.enum(["CALL", "MESSAGE", "NOTE"]), observation: z.string().trim().max(2_000).optional(), expectedVersion: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("DRAFT_NEXT_ACTION"), targetType: z.literal("LEAD"), targetId: z.string().uuid(), reason: z.string().trim().min(8).max(500), title: z.string().trim().min(3).max(160), dueAt: z.string().datetime({ offset: true }), expectedVersion: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("AUTOMATION_RESULT"), targetType: z.enum(["LEAD", "MEETING", "OPPORTUNITY", "ACCOUNT"]), targetId: z.string().uuid(), outcome: z.enum(["SUCCEEDED", "SKIPPED", "FAILED"]), resultCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/), summary: z.string().trim().min(3).max(500) }).strict(),
  z.object({ type: z.literal("CONSEQUENTIAL_ACTION"), targetType: z.enum(["LEAD", "MEETING", "OPPORTUNITY", "ACCOUNT"]), targetId: z.string().uuid(), action: z.enum(["CHANGE_OWNER", "CHANGE_STAGE", "SEND_MESSAGE", "CANCEL_MEETING", "CLOSE_OPPORTUNITY"]), reason: z.string().trim().min(12).max(500), proposedValue: z.string().trim().min(1).max(500), expectedVersion: z.number().int().positive().optional() }).strict(),
]);

export const n8nMachineRequestHeadersSchema = z.object({
  authorization: z.string().regex(/^Bearer n8n_local_[A-Za-z0-9_-]{12,240}$/),
  timestamp: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,160}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: idempotencySchema,
  correlationId: correlationSchema,
  causationId: correlationSchema.optional(),
  causationDepth: z.coerce.number().int().min(0).max(N8N_MAX_CAUSATION_DEPTH).default(0),
}).strict();

export const n8nEventQuerySchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(N8N_MAX_PAGE_SIZE).default(25),
  eventType: n8nEventTypeSchema.optional(),
}).strict();

export const n8nRecordQuerySchema = z.object({
  type: z.enum(["lead", "meeting", "opportunity", "account"]),
  id: z.string().uuid(),
}).strict();

export type N8nCommand = z.infer<typeof n8nCommandSchema>;
