import { z } from "zod";

export const customerSuccessQuerySchema = z.object({
  ownerMemberId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  health: z.enum(["HEALTHY", "ATTENTION", "RISK", "INSUFFICIENT"]).optional(),
  state: z.enum(["ACTIVE", "PAUSED", "ENDED", "REVIEW_REQUIRED"]).optional(),
  overdue: z.literal("true").transform(() => true).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).strict();

export const portfolioAssignmentSchema = z.object({
  accountId: z.string().uuid(),
  ownerMemberId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  queueId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(3).default(2),
  nextActionDescription: z.string().trim().min(3).max(500),
  nextActionAt: z.coerce.date(),
  reason: z.string().trim().min(8).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.ownerMemberId) !== Boolean(value.queueId), {
  message: "Informe exatamente um responsável ou uma fila.",
});

export const successPlanSchema = z.object({
  accountId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  objective: z.string().trim().min(8).max(2_000),
  targetAt: z.coerce.date(),
  nextActionDescription: z.string().trim().min(3).max(500),
  nextActionAt: z.coerce.date(),
  reason: z.string().trim().min(8).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const successPlanActionSchema = z.object({
  action: z.enum(["ACTIVATE", "BLOCK", "UNBLOCK", "COMPLETE", "CANCEL", "COMPLETE_MILESTONE"]),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(8).max(2_000),
  blockedReason: z.string().trim().min(3).max(1_000).optional(),
  milestoneId: z.string().uuid().optional(),
  evidence: z.string().trim().min(3).max(2_000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const healthAssessmentSchema = z.object({
  accountId: z.string().uuid(),
  cutoffAt: z.coerce.date().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export type HealthEvidenceInput = Readonly<{
  key: string;
  weight: number;
  required: boolean;
  direction: "POSITIVE" | "NEGATIVE";
  freshness: "CURRENT" | "STALE" | "MISSING";
  observedValue: number | null;
  explanation: string;
}>;

export function calculateCustomerHealth(
  evidence: readonly HealthEvidenceInput[],
  thresholds: Readonly<{ healthyMinScore: number; attentionMinScore: number }>,
) {
  const missingSignals = evidence
    .filter((item) => item.required && item.freshness !== "CURRENT")
    .map((item) => ({ key: item.key, freshness: item.freshness, explanation: item.explanation }));
  if (missingSignals.length > 0) {
    return { status: "INSUFFICIENT" as const, score: null, missingSignals };
  }
  const usable = evidence.filter((item) => item.freshness === "CURRENT" && item.observedValue !== null);
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return { status: "INSUFFICIENT" as const, score: null, missingSignals: evidence.map((item) => ({ key: item.key, freshness: item.freshness, explanation: item.explanation })) };
  const points = usable.reduce((sum, item) => {
    const normalized = item.direction === "POSITIVE" ? item.observedValue! : 100 - item.observedValue!;
    return sum + normalized * item.weight;
  }, 0);
  const score = Math.max(0, Math.min(100, Math.round(points / totalWeight)));
  const status = score >= thresholds.healthyMinScore ? "HEALTHY" : score >= thresholds.attentionMinScore ? "ATTENTION" : "RISK";
  return { status, score, missingSignals: [] } as const;
}

export function nextPlanStatus(current: string, action: z.infer<typeof successPlanActionSchema>["action"]) {
  const transitions: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    DRAFT: { ACTIVATE: "ACTIVE", CANCEL: "CANCELLED" },
    ACTIVE: { BLOCK: "BLOCKED", COMPLETE: "COMPLETED", CANCEL: "CANCELLED" },
    BLOCKED: { UNBLOCK: "ACTIVE", CANCEL: "CANCELLED" },
  };
  if (action === "COMPLETE_MILESTONE") return current;
  return transitions[current]?.[action] ?? null;
}
