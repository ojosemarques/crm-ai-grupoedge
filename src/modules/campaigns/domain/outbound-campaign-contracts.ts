import { z } from "zod";

export const outboundChannels = ["WHATSAPP", "SMS", "FLASH", "VOICE"] as const;
export type OutboundChannel = (typeof outboundChannels)[number];

const segmentSchema = z.object({
  leadIds: z.array(z.string().uuid()).max(10_000).default([]),
  csvAddresses: z.array(z.string().trim().min(3).max(320)).max(10_000).default([]),
  sourceIds: z.array(z.string().uuid()).max(100).default([]),
  tagIds: z.array(z.string().uuid()).max(100).default([]),
  offerIds: z.array(z.string().uuid()).max(100).default([]),
  fields: z.object({
    city: z.string().trim().max(120).optional(),
    stateCode: z.string().trim().length(2).optional(),
    jobTitle: z.string().trim().max(160).optional(),
    status: z.enum(["OPEN", "QUALIFIED", "DISQUALIFIED", "CONVERTED", "ARCHIVED"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  }).default({}),
}).default({ leadIds: [], csvAddresses: [], sourceIds: [], tagIds: [], offerIds: [], fields: {} });

const postActionsSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  taskTitle: z.string().trim().min(3).max(160).optional(),
  assignMemberId: z.string().uuid().optional(),
  createOpportunityName: z.string().trim().min(3).max(160).optional(),
}).default({ tagIds: [] });

export const createCampaignSchema = z.object({
  name: z.string().trim().min(3).max(160),
  channel: z.enum(outboundChannels),
  providerMode: z.enum(["LOCAL_SIMULATOR", "EXTERNAL_AUTHORIZED"]).default("LOCAL_SIMULATOR"),
  purposeKey: z.string().trim().min(2).max(100),
  templateBody: z.string().trim().min(1).max(4_000),
  segment: segmentSchema,
  postActions: postActionsSchema,
  windowStartMinute: z.number().int().min(0).max(1439).default(480),
  windowEndMinute: z.number().int().min(1).max(1440).default(1200),
  timeZone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
  scheduledAt: z.string().datetime().optional(),
  maxRecipients: z.number().int().min(1).max(10_000).default(100),
  unitCostCents: z.number().int().min(0).max(1_000_000).default(0),
}).refine((value) => value.windowStartMinute < value.windowEndMinute, { message: "A janela de envio é inválida." });

export const campaignCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), campaign: createCampaignSchema }),
  z.object({ action: z.literal("PREVIEW"), campaignId: z.string().uuid() }),
  z.object({ action: z.literal("APPROVE"), campaignId: z.string().uuid(), expectedSnapshotHash: z.string().length(64), reason: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("START"), campaignId: z.string().uuid() }),
  z.object({ action: z.literal("PROCESS_NEXT"), campaignId: z.string().uuid(), scenario: z.enum(["ACCEPT", "TRANSIENT_FAILURE", "PERMANENT_FAILURE"]).default("ACCEPT") }),
  z.object({ action: z.literal("CANCEL"), campaignId: z.string().uuid(), reason: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("RECORD_STATUS"), campaignId: z.string().uuid(), recipientId: z.string().uuid(), status: z.enum(["DELIVERED", "RESPONDED", "FAILED"]), externalEventId: z.string().trim().min(3).max(200) }),
]);

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type CampaignCommand = z.infer<typeof campaignCommandSchema>;
