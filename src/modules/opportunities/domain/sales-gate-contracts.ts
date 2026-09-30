import { z } from "zod";

export const consultativeEvidenceTypes = [
  "DIAGNOSIS",
  "ECONOMIC_BUYER",
  "SPONSOR",
  "USE_CASE",
  "PILOT_CRITERIA",
  "PROPOSAL_SCOPE",
  "DECISION",
] as const;

export type ConsultativeEvidenceType = (typeof consultativeEvidenceTypes)[number];

export const salesGateCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_EVIDENCE"),
    type: z.enum(consultativeEvidenceTypes),
    summary: z.string().trim().min(3).max(4_000),
    stakeholderName: z.string().trim().min(2).max(200).nullable().optional(),
    sourceUrl: z.string().url().max(2_000).nullable().optional(),
    expectedRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }).strict(),
  z.object({
    action: z.literal("COMPLETE_STAGE_ACTIVITY"),
    instanceId: z.string().uuid(),
    result: z.string().trim().min(3).max(2_000),
    expectedRevision: z.number().int().positive(),
  }).strict(),
  z.object({
    action: z.literal("DEFER"),
    reason: z.string().trim().min(3).max(2_000),
    reviewAt: z.string().datetime({ offset: true }),
    expectedRevision: z.number().int().positive(),
  }).strict(),
]);

export const salesReviewCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SCAN"), staleHours: z.number().int().min(24).max(8_760).default(72), maxStageDays: z.number().int().min(1).max(365).default(30) }).strict(),
  z.object({ action: z.literal("ACKNOWLEDGE_REVIEW"), reviewId: z.string().uuid(), reason: z.string().trim().min(3).max(2_000) }).strict(),
  z.object({ action: z.literal("RESOLVE_REVIEW"), reviewId: z.string().uuid(), reason: z.string().trim().min(3).max(2_000) }).strict(),
]);

export const evidenceLabels: Readonly<Record<ConsultativeEvidenceType, string>> = Object.freeze({
  DIAGNOSIS: "Diagnóstico",
  ECONOMIC_BUYER: "Comprador/decisor econômico",
  SPONSOR: "Patrocinador",
  USE_CASE: "Caso de uso",
  PILOT_CRITERIA: "Critério de piloto",
  PROPOSAL_SCOPE: "Escopo da proposta",
  DECISION: "Critério/decisão",
});
