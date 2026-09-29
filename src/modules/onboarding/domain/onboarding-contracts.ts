import { z } from "zod";

export const handoffActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["MARK_READY", "SEND", "ACCEPT", "REJECT", "CANCEL"]), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(500), idempotencyKey: z.string().trim().min(8).max(160) }),
]);
export const onboardingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["START", "UNBLOCK", "ACTIVATE", "COMPLETE", "CANCEL"]), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(500), idempotencyKey: z.string().trim().min(8).max(160) }),
  z.object({ action: z.literal("BLOCK"), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(8).max(500), reasonCode: z.string().trim().min(3).max(80), idempotencyKey: z.string().trim().min(8).max(160) }),
  z.object({ action: z.literal("COMPLETE_MILESTONE"), expectedRevision: z.number().int().positive(), milestoneId: z.string().uuid(), evidence: z.string().trim().min(3).max(1000), reason: z.string().trim().min(8).max(500), idempotencyKey: z.string().trim().min(8).max(160) }),
  z.object({ action: z.literal("REASSIGN"), expectedRevision: z.number().int().positive(), ownerMemberId: z.string().uuid(), reason: z.string().trim().min(8).max(500), idempotencyKey: z.string().trim().min(8).max(160) }),
]);
export const createHandoffSchema = z.object({ opportunityId: z.string().uuid(), ownerMemberId: z.string().uuid(), reason: z.string().trim().min(8).max(500), idempotencyKey: z.string().trim().min(8).max(160) });

const handoffTransitions: Record<string, readonly string[]> = { DRAFT: ["READY", "CANCELLED"], READY: ["SENT", "CANCELLED"], SENT: ["ACCEPTED", "REJECTED", "CANCELLED"], REQUESTED: ["ACCEPTED", "REJECTED", "CANCELLED"], REJECTED: ["READY"], ACCEPTED: ["COMPLETED"] };
const onboardingTransitions: Record<string, readonly string[]> = { PENDING: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["BLOCKED", "ACTIVATED", "CANCELLED"], BLOCKED: ["IN_PROGRESS", "CANCELLED"], ACTIVATED: ["COMPLETED", "BLOCKED"], COMPLETED: [], CANCELLED: [] };
export function canTransitionHandoff(from: string, to: string) { return handoffTransitions[from]?.includes(to) ?? false; }
export function canTransitionOnboarding(from: string, to: string) { return onboardingTransitions[from]?.includes(to) ?? false; }
export function addWorkspaceDays(at: Date, days: number) { return new Date(at.getTime() + days * 86_400_000); }
