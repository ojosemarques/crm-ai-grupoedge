import { z } from "zod";

export const qualityIssueStatuses = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
export const qualitySeverities = ["INFO", "WARNING", "HIGH", "CRITICAL"] as const;
export const mergeEntityTypes = ["CONTACT", "ACCOUNT"] as const;

export const dataQualityQuerySchema = z.object({
  status: z.enum([...qualityIssueStatuses, "ALL"]).default("OPEN"),
  severity: z.enum([...qualitySeverities, "ALL"]).default("ALL"),
  entityType: z.string().trim().max(80).default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).strict();

export const scanInputSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();

export const issueActionSchema = z.object({
  issueId: z.string().uuid(),
  action: z.enum(["ASSIGN_TO_ME", "COMMENT", "RESOLVE", "DISMISS"]),
  reason: z.string().trim().min(3).max(500),
  expectedRevision: z.number().int().positive(),
}).strict();

export const candidateDecisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.literal("NOT_DUPLICATE"),
  reason: z.string().trim().min(8).max(500),
  expectedRevision: z.number().int().positive(),
}).strict();

export const mergePreviewSchema = z.object({
  candidateId: z.string().uuid(),
  survivorEntityId: z.string().uuid(),
}).strict();

export const mergePlanSchema = z.object({
  candidateId: z.string().uuid(),
  survivorEntityId: z.string().uuid(),
  reason: z.string().trim().min(8).max(500),
  previewFingerprint: z.string().min(16).max(128),
  decisions: z.array(z.object({
    fieldPath: z.string().trim().min(1).max(80),
    strategy: z.enum(["SURVIVOR", "SOURCE"]),
  }).strict()).max(20),
}).strict();

export const mergeApplySchema = z.object({
  mergePlanId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  confirmation: z.literal("CONFIRMAR MERGE"),
}).strict();

export const mergeRollbackSchema = z.object({
  mergePlanId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  reason: z.string().trim().min(8).max(500),
  confirmation: z.literal("CONFIRMAR REVERSÃO"),
}).strict();

export type DataQualityQuery = z.infer<typeof dataQualityQuerySchema>;

export type MergePreview = Readonly<{
  entityType: "CONTACT" | "ACCOUNT";
  source: Readonly<{ id: string; label: string; revision: string }>;
  survivor: Readonly<{ id: string; label: string; revision: string }>;
  fields: readonly Readonly<{
    fieldPath: string;
    label: string;
    sourceValue: string | null;
    survivorValue: string | null;
    recommended: "SOURCE" | "SURVIVOR";
  }>[];
  relationships: Readonly<Record<string, number>>;
  blockers: readonly string[];
  previewFingerprint: string;
}>;
