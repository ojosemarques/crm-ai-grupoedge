import { z } from "zod";

const activitySchema = z.object({
  activityType: z.string().trim().min(2).max(50),
  title: z.string().trim().min(2).max(160),
  script: z.string().trim().max(4_000).nullable().optional(),
  dueOffsetDays: z.number().int().min(0).max(365),
  position: z.number().int().min(0),
  required: z.boolean().default(false),
  reentryPolicy: z.enum(["RECREATE_ON_REENTRY", "ONCE_PER_OPPORTUNITY"]).default("RECREATE_ON_REENTRY"),
}).strict();

const requiredFieldSchema = z.object({
  fieldKey: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(160),
  offerTemplateId: z.string().uuid().nullable().optional(),
}).strict();

const stageSchema = z.object({
  stableKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,49}$/),
  name: z.string().trim().min(2).max(100),
  position: z.number().int().min(0),
  type: z.enum(["OPEN", "WON", "LOST"]),
  leadStageCode: z.enum(["NEW", "TRYING_CONTACT", "CONNECTED", "IN_QUALIFICATION", "QUALIFIED", "MEETING_SCHEDULED", "NURTURING", "DISQUALIFIED"]).nullable().optional(),
  opportunityStageCode: z.enum(["MEETING_SCHEDULED", "MEETING_HELD", "OPPORTUNITY_CONFIRMED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]).nullable().optional(),
  activities: z.array(activitySchema).max(50).default([]),
  requiredFields: z.array(requiredFieldSchema).max(50).default([]),
}).strict();

export const saveTemplateSchema = z.object({
  action: z.literal("SAVE_TEMPLATE"),
  templateId: z.string().uuid().nullable().optional(),
  expectedVersion: z.number().int().positive().nullable().optional(),
  mode: z.enum(["UPDATE_SHARED", "SAVE_AS_NEW"]),
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,49}$/),
  name: z.string().trim().min(2).max(100),
  entityType: z.enum(["LEAD", "OPPORTUNITY"]),
  changeReason: z.string().trim().min(3).max(500),
  pipelineIds: z.array(z.string().uuid()).max(50).default([]),
  stages: z.array(stageSchema).min(2).max(30),
}).strict().superRefine((value, context) => {
  const positions = new Set(value.stages.map((stage) => stage.position));
  const keys = new Set(value.stages.map((stage) => stage.stableKey));
  if (positions.size !== value.stages.length || keys.size !== value.stages.length) context.addIssue({ code: "custom", message: "Etapas exigem posições e chaves únicas." });
  if (value.entityType === "LEAD" && value.stages.some((stage) => !stage.leadStageCode || stage.opportunityStageCode)) context.addIssue({ code: "custom", message: "Modelo de lead exige código de lead em todas as etapas." });
  if (value.entityType === "OPPORTUNITY" && value.stages.some((stage) => !stage.opportunityStageCode || stage.leadStageCode)) context.addIssue({ code: "custom", message: "Modelo de oportunidade exige código de oportunidade em todas as etapas." });
});

export const pipelineTemplateCommandSchema = z.discriminatedUnion("action", [
  saveTemplateSchema,
  z.object({ action: z.literal("COPY_TEMPLATE"), sourceTemplateVersionId: z.string().uuid(), pipelineId: z.string().uuid(), key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,49}$/), name: z.string().trim().min(2).max(100), changeReason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive().nullable().optional() }).strict(),
  z.object({ action: z.literal("SAVE_ORIGIN_GROUP"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(2).max(100), teamId: z.string().uuid().nullable().optional(), sourceIds: z.array(z.string().uuid()).min(1), active: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("SAVE_ACCESS_RULE"), id: z.string().uuid().nullable().optional(), sourceId: z.string().uuid(), teamId: z.string().uuid(), canRead: z.boolean(), canDistribute: z.boolean(), canReassign: z.boolean(), canTransition: z.boolean() }).strict(),
  z.object({ action: z.literal("PREVIEW_MIGRATION"), pipelineId: z.string().uuid(), toTemplateVersionId: z.string().uuid(), stageMapping: z.record(z.string().uuid(), z.string().trim().min(2).max(50)), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("APPLY_MIGRATION"), migrationId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("ROLLBACK_MIGRATION"), migrationId: z.string().uuid(), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict(),
]);

export const opportunityBulkPreviewSchema = z.object({
  opportunityIds: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["REASSIGN", "TRANSITION"]),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  expectedRevisions: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict()).min(1),
}).strict();

export const opportunityBulkExecuteSchema = z.object({ operationId: z.string().uuid() }).strict();

export type SaveTemplateCommand = z.infer<typeof saveTemplateSchema>;
