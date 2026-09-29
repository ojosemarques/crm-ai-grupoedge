import { z } from "zod";

const id = z.string().uuid();
const cents = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(BigInt);
const reason = z.string().trim().min(3).max(2_000);
const idem = z.string().trim().min(8).max(200);

export const farmerQuerySchema = z.object({
  ownerMemberId: id.optional(), teamId: id.optional(),
  status: z.enum(["IN_REVIEW", "RENEWED", "NOT_RENEWED", "DEFERRED", "CANCELLED"]).optional(),
  riskLevel: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  windowDays: z.coerce.number().int().min(0).max(365).optional(),
  action: z.enum(["OVERDUE", "MISSING", "EXPANSION", "REVENUE_REVIEW"]).optional(),
  minMrrCents: z.coerce.bigint().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).strict();

export const createRenewalSchema = z.object({
  subscriptionId: id, targetDate: z.coerce.date(), nextActionDescription: z.string().trim().min(3).max(500),
  nextActionAt: z.coerce.date(), idempotencyKey: idem,
}).strict();

export const renewalActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SET_RISK"), expectedRevision: z.number().int().positive(), riskLevel: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]), riskReasonCode: z.string().trim().min(2).max(80).optional(), evidence: z.string().trim().min(3).max(2_000).optional(), reason, idempotencyKey: idem }).refine(v => v.riskLevel === "NONE" || Boolean(v.riskReasonCode && v.evidence), { message: "Risco exige motivo e evidência." }),
  z.object({ action: z.literal("NEXT_ACTION"), expectedRevision: z.number().int().positive(), nextActionDescription: z.string().trim().min(3).max(500), nextActionAt: z.coerce.date(), reason, idempotencyKey: idem }),
  z.object({ action: z.enum(["RENEW", "NOT_RENEW", "CANCEL"]), expectedRevision: z.number().int().positive(), reasonCode: z.string().trim().min(2).max(80), comment: reason, idempotencyKey: idem }),
  z.object({ action: z.literal("DEFER"), expectedRevision: z.number().int().positive(), targetDate: z.coerce.date(), nextActionDescription: z.string().trim().min(3).max(500), nextActionAt: z.coerce.date(), reasonCode: z.string().trim().min(2).max(80), comment: reason, idempotencyKey: idem }),
  z.object({ action: z.literal("REOPEN"), expectedRevision: z.number().int().positive(), nextActionDescription: z.string().trim().min(3).max(500), nextActionAt: z.coerce.date(), reason, idempotencyKey: idem }),
]);

export const expansionSignalSchema = z.object({
  accountId: id, subscriptionId: id.nullable().optional(), type: z.string().trim().min(2).max(100),
  source: z.string().trim().min(2).max(100), evidence: reason, capturedAt: z.coerce.date(),
  confidenceBps: z.number().int().min(0).max(10_000).nullable().optional(), validUntil: z.coerce.date().nullable().optional(),
  estimatedMrrCents: cents.nullable().optional(), estimatedTcvCents: cents.nullable().optional(), productId: id.nullable().optional(),
  idempotencyKey: idem,
}).strict();

export const expansionReviewSchema = z.object({
  signalId: id, action: z.enum(["REJECT", "CONFIRM_AND_LINK"]), expectedRevision: z.number().int().positive(),
  reasonCode: z.string().trim().min(2).max(80), comment: reason,
  nextActionDescription: z.string().trim().min(3).max(500).optional(), nextActionAt: z.coerce.date().optional(),
  idempotencyKey: idem,
}).strict();

export const farmerRevenueDecisionSchema = z.object({
  subscriptionId: id, renewalId: id.nullable().optional(), type: z.enum(["CONTRACTION", "CHURN"]),
  newMrrCents: cents, effectiveAt: z.coerce.date(), reasonCode: z.string().trim().min(2).max(80),
  comment: reason, evidence: reason, logoChurn: z.boolean().default(false), revenueChurn: z.boolean().default(false),
  idempotencyKey: idem,
}).strict();

export const farmerCorrectionSchema = z.object({ decisionId: id, reason: z.string().trim().min(8).max(2_000), idempotencyKey: idem }).strict();
export const farmerBackfillSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: idem }).strict();

export type RenewalState = "IN_REVIEW" | "RENEWED" | "NOT_RENEWED" | "DEFERRED" | "CANCELLED";
export type RenewalAction = "RENEW" | "NOT_RENEW" | "DEFER" | "CANCEL" | "REOPEN";

export function nextRenewalStatus(current: RenewalState, action: RenewalAction): RenewalState | null {
  if (action === "REOPEN") return ["RENEWED", "NOT_RENEWED", "CANCELLED"].includes(current) ? "IN_REVIEW" : null;
  if (!["IN_REVIEW", "DEFERRED"].includes(current)) return null;
  return ({ RENEW: "RENEWED", NOT_RENEW: "NOT_RENEWED", DEFER: "DEFERRED", CANCEL: "CANCELLED" } as const)[action] ?? null;
}

export function farmerPriority(input: Readonly<{ targetDate: Date; nextActionAt: Date | null; status: RenewalState; riskLevel: string; baseMrrCents: bigint; now: Date; pendingRevenueReview?: boolean; pendingExpansion?: boolean }>) {
  const open = input.status === "IN_REVIEW" || input.status === "DEFERRED";
  if (open && (!input.nextActionAt || input.nextActionAt < input.now)) return { rank: 1, reason: input.nextActionAt ? "Próxima ação vencida" : "Renovação sem próxima ação" };
  if (input.pendingRevenueReview) return { rank: 2, reason: "Contração ou churn requer revisão" };
  if (open && ["HIGH", "CRITICAL"].includes(input.riskLevel)) return { rank: 3, reason: `MRR em risco: ${input.riskLevel.toLowerCase()}` };
  if (input.pendingExpansion) return { rank: 4, reason: "Sinal de expansão aguarda decisão humana" };
  return { rank: 5, reason: open ? "Próxima ação programada" : "Decisão registrada" };
}

export function renewalRate(renewed: number, decided: number) {
  return decided === 0 ? null : renewed / decided;
}

export function netRevenueRetention(openingMrr: bigint | null, expansion: bigint, contraction: bigint, churn: bigint) {
  if (openingMrr === null || openingMrr <= 0n) return null;
  return Number(openingMrr + expansion + contraction + churn) / Number(openingMrr);
}
