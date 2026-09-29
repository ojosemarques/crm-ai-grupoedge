import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || undefined);

export const marketingEvidenceInputSchema = z.object({
  sessionPublicId: optionalText(160),
  landingPageKey: optionalText(120),
  marketingFormKey: optionalText(120),
  marketingFormVersion: z.number().int().positive().optional(),
  landingUrl: optionalText(2_048),
  referrerUrl: optionalText(2_048),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(300),
  utmContent: optionalText(300),
  utmTerm: optionalText(300),
  clickIds: z.partialRecord(z.enum(["gclid", "fbclid", "msclkid", "ttclid"]), z.string().trim().min(1).max(1_000)).optional(),
}).strict();

export const attributionRunInputSchema = z.object({
  modelKey: z.string().trim().min(2).max(120),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => value.periodEnd > value.periodStart, {
  message: "O fim do período deve ser posterior ao início.",
  path: ["periodEnd"],
});

export const landingPageDefinitionSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,119}$/),
  name: z.string().trim().min(2).max(160),
  canonicalUrl: z.string().url().max(2_048),
  title: z.string().trim().max(200).optional(),
  definition: z.record(z.string(), z.json()).default({}),
}).strict();

export const marketingFormDefinitionSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,119}$/),
  name: z.string().trim().min(2).max(160),
  landingPageId: z.string().uuid().nullable().optional(),
  definition: z.record(z.string(), z.json()).default({}),
}).strict();

export const attributionModelVersionInputSchema = z.object({
  modelId: z.string().uuid(),
  algorithm: z.enum(["FIRST_TOUCH", "LAST_TOUCH", "LINEAR"]),
  lookbackDays: z.number().int().min(1).max(3650),
  reason: z.string().trim().min(3).max(1_000),
}).strict();

export const marketingBackfillInputSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  idempotencyKey: z.string().trim().min(8).max(200),
  limit: z.number().int().min(1).max(10_000).default(2_000),
}).strict();

export const acquisitionQuerySchema = z.object({
  modelKey: z.string().trim().max(120).default("last-touch"),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  sourceId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  creativeId: z.string().uuid().optional(),
  evidenceClass: z.enum(["DIRECT", "DERIVED", "LEGACY_REVIEW_REQUIRED", "UNKNOWN"]).optional(),
  reviewStatus: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
}).strict();

export type MarketingEvidenceInput = z.input<typeof marketingEvidenceInputSchema>;
export type AttributionRunInput = z.input<typeof attributionRunInputSchema>;

export type AttributionTouchpointInput = Readonly<{
  id: string;
  occurredAt: Date;
  eligible: boolean;
  evidenceClass: "DIRECT" | "DERIVED" | "LEGACY_REVIEW_REQUIRED" | "UNKNOWN";
}>;

export type AttributionCreditResult = Readonly<{
  touchpointId: string | null;
  creditBps: number;
  coverageState: "COMPLETE" | "PARTIAL" | "UNATTRIBUTED";
  reasonCode: string;
  explanation: string;
}>;
