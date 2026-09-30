import { z } from "zod";

export const apiResourceSchema = z.enum(["contacts", "accounts", "deals", "sources", "fields"]);
export type ApiResource = z.infer<typeof apiResourceSchema>;

export const apiListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createPayloadSchemas = {
  contacts: z.object({ preferredName: z.string().trim().min(2).max(200), legalName: nullableText(200), jobTitle: nullableText(160), timeZone: nullableText(80), locale: z.string().trim().min(2).max(20).default("pt-BR") }).strict(),
  accounts: z.object({ name: z.string().trim().min(2).max(200), legalName: nullableText(200), segment: z.enum(["PUBLIC_SECTOR", "POLITICAL", "PRIVATE_SECTOR", "NONPROFIT", "OTHER", "UNKNOWN"]).default("UNKNOWN"), size: z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"]).default("UNKNOWN") }).strict(),
  deals: z.object({ leadId: z.string().uuid(), ownerMemberId: z.string().uuid(), accountId: z.string().uuid().nullable().optional(), name: z.string().trim().min(2).max(200), interestDescription: z.string().trim().min(3).max(1000), amountCents: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]), probabilityPercent: z.number().int().min(0).max(100).default(0), expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional() }).strict(),
  sources: z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,79}$/), name: z.string().trim().min(2).max(160), type: z.enum(["MANUAL", "FORM", "IMPORT", "WEBHOOK", "REFERRAL", "ORGANIC", "PAID_MEDIA", "OTHER"]), externalRef: nullableText(200) }).strict(),
  fields: z.object({ entityType: z.enum(["CONTACT", "ACCOUNT", "LEAD", "OPPORTUNITY"]), key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/), name: z.string().trim().min(2).max(160), dataType: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT", "MULTI_SELECT"]), options: z.array(z.string().trim().min(1).max(100)).max(100).optional(), required: z.boolean().default(false) }).strict(),
} as const;

export const updatePayloadSchemas = {
  contacts: createPayloadSchemas.contacts.partial().extend({ expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(),
  accounts: createPayloadSchemas.accounts.partial().extend({ expectedRevision: z.number().int().positive() }).strict(),
  deals: z.object({ expectedRevision: z.number().int().positive(), name: z.string().trim().min(2).max(200).optional(), interestDescription: z.string().trim().min(3).max(1000).optional(), amountCents: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(), probabilityPercent: z.number().int().min(0).max(100).optional(), expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional() }).strict(),
  sources: createPayloadSchemas.sources.partial().extend({ expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(),
  fields: createPayloadSchemas.fields.omit({ entityType: true, key: true }).partial().extend({ expectedRevision: z.number().int().positive() }).strict(),
} as const;

export const deletePayloadSchema = z.object({ expectedRevision: z.number().int().positive().optional(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional(), reason: z.string().trim().min(3).max(500) }).strict();

export const API_CONTRACT_VERSION = "2026-09-30";
