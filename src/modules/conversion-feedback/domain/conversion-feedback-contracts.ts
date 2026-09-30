import { z } from "zod";

export const META_CONVERSION_EVENT_TYPE = "marketing.meta_conversion.v1";
export const META_CONVERSION_PURPOSE_CODE = "marketing-conversion-feedback";

export const metaConversionCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("VALIDATE_WRITE_CAPABILITY"),
  }).strict(),
  z.object({
    action: z.literal("QUEUE"),
    conversionId: z.string().uuid(),
    eventName: z.enum(["Lead", "CompleteRegistration", "Schedule", "Purchase"]),
    idempotencyKey: z.string().trim().regex(/^meta-conversion-[A-Za-z0-9_-]{8,100}$/),
  }).strict(),
  z.object({
    action: z.literal("CANCEL_PENDING"),
    conversionId: z.string().uuid(),
    reason: z.string().trim().min(8).max(500),
  }).strict(),
]);

export const reconciliationQuerySchema = z.object({
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
}).strict();

export const googleConversionCommandSchema = z.object({
  action: z.literal("VALIDATE_WRITE_CAPABILITY"),
}).strict();

export type MetaConversionCommand = z.output<typeof metaConversionCommandSchema>;
