import { z } from "zod";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(2).max(max);
const base = { expectedRevision: z.number().int().min(0), idempotencyKey: z.string().trim().min(8).max(200) } as const;

export const accountPlanEpisodeTypes = ["DISCOVERY", "SOLUTION", "PILOT", "CUSTOMER_WAIT", "CONTRACTING", "INSTITUTIONAL_NURTURE"] as const;
export const accountPlanTrackTypes = ["STAKEHOLDER", "POLITIZAI_DELIVERY", "IMPEDIMENT", "DECISION"] as const;

export const accountPlanCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START_EPISODE"), type: z.enum(accountPlanEpisodeTypes), title: text(160), objective: text(2_000), ownerMemberId: id.nullable(), dueAt: z.string().datetime().nullable().optional(), artifactUrl: z.string().url().max(2_000).nullable().optional(), ...base }).strict(),
  z.object({ action: z.literal("UPSERT_TRACK"), type: z.enum(accountPlanTrackTypes), milestone: text(500), artifactTitle: z.string().trim().max(300).nullable().optional(), artifactUrl: z.string().url().max(2_000).nullable().optional(), ownerMemberId: id.nullable(), dueAt: z.string().datetime(), ...base }).strict(),
  z.object({ action: z.literal("PLAN_WAIT"), reason: text(1_000), reviewAt: z.string().datetime(), ownerMemberId: id, ...base }).strict(),
  z.object({ action: z.literal("CHANGE_STAKEHOLDER"), name: text(200), role: text(200), isDecisionMaker: z.boolean(), replacesStakeholderId: id.nullable().optional(), ...base }).strict(),
  z.object({ action: z.literal("COMPLETE_COMMITMENT"), commitmentType: z.enum(["EPISODE", "TRACK", "WAIT"]), commitmentId: id, result: text(1_000), ...base }).strict(),
  z.object({ action: z.literal("REGISTER_EVENT"), event: z.enum(["RESPONSE", "OPT_OUT"]), ...base }).strict(),
]);

export type AccountPlanCommand = z.infer<typeof accountPlanCommandSchema>;
