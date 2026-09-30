import { z } from "zod";

export const acquisitionProviderSchema = z.enum(["FORM", "LANDING_PAGE", "META_LEAD_ADS", "TYPEFORM"]);
export type AcquisitionProvider = z.infer<typeof acquisitionProviderSchema>;

const canonicalFields = ["fullName", "phone", "email", "jobTitle", "organizationName", "city", "stateCode", "interestSummary", "budgetCents", "consent", "campaignExternalRef", "creativeExternalRef", "sessionPublicId", "landingUrl", "referrerUrl", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "fbclid", "gclid"] as const;
export const acquisitionConnectionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]{2,63}$/),
  displayName: z.string().trim().min(3).max(100),
  provider: acquisitionProviderSchema,
  sourceKey: z.string().trim().min(1).max(120),
  secretReferenceKey: z.string().trim().regex(/^(?:META_ADS|TYPEFORM|ACQUISITION)_[A-Z0-9_]{3,120}$/),
  verificationTokenReferenceKey: z.string().trim().regex(/^META_ADS_[A-Z0-9_]{3,120}$/).optional(),
  enrichmentTokenReferenceKey: z.string().trim().regex(/^META_ADS_[A-Z0-9_]{3,120}$/).optional(),
  mapping: z.partialRecord(z.enum(canonicalFields), z.string().trim().regex(/^[A-Za-z0-9_.-]{1,120}$/)),
  definition: z.object({ name: z.string().trim().min(2).max(160), canonicalUrl: z.string().url().max(500).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Use URL HTTP ou HTTPS.").optional(), title: z.string().trim().max(200).optional() }).optional(),
}).strict().superRefine((value, ctx) => {
  for (const required of ["fullName", "phone"] as const) if (!value.mapping[required]) ctx.addIssue({ code: "custom", path: ["mapping", required], message: `${required} é obrigatório.` });
  if (value.provider === "LANDING_PAGE" && !value.definition?.canonicalUrl) ctx.addIssue({ code: "custom", path: ["definition", "canonicalUrl"], message: "Landing page exige URL canônica." });
  if (value.provider === "META_LEAD_ADS" && !value.verificationTokenReferenceKey) ctx.addIssue({ code: "custom", path: ["verificationTokenReferenceKey"], message: "Meta exige referência separada para o verify token." });
  if (value.provider === "META_LEAD_ADS" && !value.enrichmentTokenReferenceKey) ctx.addIssue({ code: "custom", path: ["enrichmentTokenReferenceKey"], message: "Meta exige referência de token de enriquecimento por conexão." });
  if (value.verificationTokenReferenceKey && value.verificationTokenReferenceKey === value.secretReferenceKey) ctx.addIssue({ code: "custom", path: ["verificationTokenReferenceKey"], message: "Verify token e segredo de assinatura devem ser separados." });
  if (value.enrichmentTokenReferenceKey && [value.secretReferenceKey, value.verificationTokenReferenceKey].includes(value.enrichmentTokenReferenceKey)) ctx.addIssue({ code: "custom", path: ["enrichmentTokenReferenceKey"], message: "O token de enriquecimento deve usar referência própria." });
});

export const ACQUISITION_CONTRACT_VERSION = "1.0";
export const ACQUISITION_MAX_WEBHOOK_BYTES = 256 * 1024;

export const acquisitionConnectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE"), connectionId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("UPDATE_MAPPING"), connectionId: z.string().uuid(), revision: z.number().int().positive(), mapping: z.partialRecord(z.enum(canonicalFields), z.string().trim().regex(/^[A-Za-z0-9_.-]{1,120}$/)).refine((mapping) => Boolean(mapping.fullName && mapping.phone), "fullName e phone são obrigatórios.") }).strict(),
  z.object({ action: z.literal("ROLLBACK_MAPPING"), connectionId: z.string().uuid(), revision: z.number().int().positive(), targetVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("REVOKE"), connectionId: z.string().uuid(), revision: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict(),
]);
