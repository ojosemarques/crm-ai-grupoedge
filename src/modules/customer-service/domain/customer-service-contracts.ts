import { z } from "zod";

const channel = z.enum(["MANUAL", "EMAIL", "WHATSAPP", "PHONE", "MEETING", "IN_APP", "OTHER"]);
const category = z.enum(["ACTIVATION", "ADOPTION", "COMMERCIAL", "BILLING", "ADJUSTMENT", "COMPLAINT", "DELIVERY", "RELATIONSHIP"]);
const priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const status = z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]);

export const customerServiceQuerySchema = z.object({
  ownerMemberId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), queueId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(), category: category.optional(), priority: priority.optional(), status: status.optional(),
  channel: channel.optional(), slaPolicyVersionId: z.string().uuid().optional(), surveyType: z.enum(["CSAT", "NPS"]).optional(),
  sla: z.enum(["FIRST_RESPONSE_OVERDUE", "RESOLUTION_OVERDUE", "RESOLVED_WITHIN"]).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).strict().refine((value) => !value.from || !value.to || value.from < value.to, { message: "O período deve seguir [from,to)." });

export const openCustomerRequestSchema = z.object({
  accountId: z.string().uuid(), contactId: z.string().uuid().nullable().optional(), channel, subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(4_000), category, priority: priority.default("NORMAL"),
  ownerMemberId: z.string().uuid().nullable().optional(), queueId: z.string().uuid().nullable().optional(), teamId: z.string().uuid().nullable().optional(),
  nextActionDescription: z.string().trim().min(3).max(500), nextActionAt: z.coerce.date(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.ownerMemberId) !== Boolean(value.queueId), { message: "Informe exatamente um responsável ou uma fila." });

export const assignCustomerRequestSchema = z.object({
  ownerMemberId: z.string().uuid().nullable().optional(), queueId: z.string().uuid().nullable().optional(), teamId: z.string().uuid().nullable().optional(),
  expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(2_000), idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.ownerMemberId) !== Boolean(value.queueId), { message: "Informe exatamente um responsável ou uma fila." });

export const customerRequestActionSchema = z.object({
  action: z.enum(["FIRST_RESPONSE", "UPDATE_NEXT_ACTION", "START", "WAIT_CUSTOMER", "RESOLVE", "CLOSE", "REOPEN"]),
  expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(2_000),
  nextActionDescription: z.string().trim().min(3).max(500).optional(), nextActionAt: z.coerce.date().optional(),
  resolutionNote: z.string().trim().min(3).max(2_000).optional(), idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const publishSlaVersionSchema = z.object({
  policyKey: z.string().trim().regex(/^[a-z0-9-]+$/), name: z.string().trim().min(3).max(120),
  firstResponseMinutes: z.number().int().positive().max(43_200), resolutionMinutes: z.number().int().positive().max(525_600),
  effectiveFrom: z.coerce.date(), timeZone: z.literal("America/Sao_Paulo").default("America/Sao_Paulo"),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => value.resolutionMinutes >= value.firstResponseMinutes, { message: "A resolução não pode vencer antes da primeira resposta." });

export const publishSurveyVersionSchema = z.object({
  definitionKey: z.string().trim().regex(/^[a-z0-9-]+$/), name: z.string().trim().min(3).max(120), type: z.enum(["CSAT", "NPS"]),
  question: z.string().trim().min(5).max(500), minValue: z.number().int().min(0).max(9), maxValue: z.number().int().min(1).max(10),
  labels: z.record(z.string(), z.string().max(100)).optional(), effectiveFrom: z.coerce.date(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (value.maxValue <= value.minValue) context.addIssue({ code: "custom", message: "A escala é inválida." });
  if (value.type === "NPS" && (value.minValue !== 0 || value.maxValue !== 10)) context.addIssue({ code: "custom", message: "NPS deve usar a escala 0–10." });
});

export const surveyInvitationSchema = z.object({
  accountId: z.string().uuid(), requestId: z.string().uuid().nullable().optional(), surveyType: z.enum(["CSAT", "NPS"]), channel,
  expiresAt: z.coerce.date(), idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const surveyResponseSchema = z.object({
  invitationId: z.string().uuid(), value: z.number().int().min(0).max(10), comment: z.string().trim().max(2_000).nullable().optional(),
  answeredAt: z.coerce.date().optional(), supersedesId: z.string().uuid().nullable().optional(), idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export type RequestStatus = z.infer<typeof status>;
export function nextCustomerRequestStatus(current: RequestStatus, action: z.infer<typeof customerRequestActionSchema>["action"]): RequestStatus | null {
  if (["FIRST_RESPONSE", "UPDATE_NEXT_ACTION"].includes(action)) return current;
  const transitions: Record<RequestStatus, Partial<Record<z.infer<typeof customerRequestActionSchema>["action"], RequestStatus>>> = {
    OPEN: { START: "IN_PROGRESS", WAIT_CUSTOMER: "WAITING_CUSTOMER", RESOLVE: "RESOLVED" },
    IN_PROGRESS: { WAIT_CUSTOMER: "WAITING_CUSTOMER", RESOLVE: "RESOLVED" },
    WAITING_CUSTOMER: { START: "IN_PROGRESS", RESOLVE: "RESOLVED" },
    RESOLVED: { CLOSE: "CLOSED", REOPEN: "IN_PROGRESS" }, CLOSED: { REOPEN: "IN_PROGRESS" },
  };
  return transitions[current][action] ?? null;
}

export function elapsedSeconds(start: Date, end: Date) { return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1_000)); }
export function classifySurvey(type: "CSAT" | "NPS", value: number, minValue: number, maxValue: number) {
  if (value < minValue || value > maxValue) return null;
  if (type === "NPS") return value <= 6 ? "DETRACTOR" : value <= 8 ? "PASSIVE" : "PROMOTER";
  const midpoint = (minValue + maxValue) / 2;
  return value > midpoint ? "SATISFIED" : value < midpoint ? "DISSATISFIED" : "NEUTRAL";
}

export function calculateSatisfaction(type: "CSAT" | "NPS", values: readonly number[], invitations: number) {
  if (!values.length) return { value: null, validResponses: 0, responseRate: invitations ? 0 : null, distribution: {} as Record<string, number> };
  const distribution: Record<string, number> = {};
  if (type === "NPS") for (const value of values) { const key = classifySurvey(type, value, 0, 10)!; distribution[key] = (distribution[key] ?? 0) + 1; }
  const value = type === "CSAT" ? values.reduce((sum, item) => sum + item, 0) / values.length : (((distribution.PROMOTER ?? 0) - (distribution.DETRACTOR ?? 0)) / values.length) * 100;
  return { value, validResponses: values.length, responseRate: invitations ? values.length / invitations : null, distribution };
}
