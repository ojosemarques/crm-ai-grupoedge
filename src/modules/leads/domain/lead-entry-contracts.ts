import { z } from "zod";
import { marketingEvidenceInputSchema } from "@/modules/marketing/domain/marketing-contracts";

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Informe um e-mail válido.")
  .max(320)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const leadEntryFieldsSchema = z
  .object({
    fullName: z.string().trim().min(2, "Informe o nome.").max(200),
    phone: z.string().trim().min(1, "Informe o telefone.").max(80),
    email: optionalEmail,
    jobTitle: optionalText(160),
    organizationName: optionalText(200),
    city: optionalText(120),
    stateCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(2, "A UF deve ter duas letras.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    interestSummary: optionalText(2_000),
    budgetBrl: optionalText(40),
    sourceKey: z.string().trim().min(1, "Informe a origem.").max(120),
    campaignExternalRef: optionalText(200),
    creativeExternalRef: optionalText(200),
    consent: z.boolean().optional(),
    doNotContact: z.boolean().optional(),
    priorityBandCode: z.enum(["P1", "P2", "P3"]),
    acquisition: marketingEvidenceInputSchema.optional(),
    requestedOffer: z.object({ catalogItemId: z.string().uuid(), version: z.number().int().positive() }).strict().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.budgetBrl) {
      try {
        parseBrlToCents(value.budgetBrl);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["budgetBrl"],
          message:
            error instanceof Error
              ? error.message
              : "O orçamento informado é inválido.",
        });
      }
    }
    if (value.creativeExternalRef && !value.campaignExternalRef) {
      context.addIssue({
        code: "custom",
        path: ["creativeExternalRef"],
        message: "O criativo exige uma campanha.",
      });
    }
    if (value.consent && value.doNotContact) {
      context.addIssue({
        code: "custom",
        path: ["doNotContact"],
        message: "Consentimento e não contatar não podem coexistir.",
      });
    }
  });

export const manualLeadEntryRequestSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const request = value as Record<string, unknown>;
    if (!request.lead || typeof request.lead !== "object" || Array.isArray(request.lead)) return value;
    const lead = request.lead as Record<string, unknown>;
    if (typeof lead.sourceKey === "string" && lead.sourceKey.trim()) return value;
    return { ...request, lead: { ...lead, sourceKey: "manual" } };
  },
  z
    .object({
      idempotencyKey: z.string().trim().min(8).max(160),
      lead: leadEntryFieldsSchema,
    })
    .strict(),
);

export const localWebhookRequestSchema = z
  .object({
    eventId: z.string().trim().min(1).max(160),
    eventType: z.literal("lead.received").default("lead.received"),
    lead: leadEntryFieldsSchema,
  })
  .strict();

export const simulatorRequestSchema = z
  .object({
    scenario: z.enum(["P1", "P2", "P3", "DUPLICATE"]),
    count: z.number().int().min(1).max(20),
    seed: z.string().trim().min(1).max(80),
    sourceKey: z.string().trim().min(1).max(120),
    campaignExternalRef: optionalText(200),
    creativeExternalRef: optionalText(200),
    city: optionalText(120),
    stateCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(2)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .strict();

export const csvColumnMappingSchema = z
  .object({
    fullName: z.string().trim().min(1),
    phone: z.string().trim().min(1),
    email: optionalText(200),
    jobTitle: optionalText(200),
    organizationName: optionalText(200),
    city: optionalText(200),
    stateCode: optionalText(200),
    interestSummary: optionalText(200),
    budgetBrl: optionalText(200),
    sourceKey: optionalText(200),
    campaignExternalRef: optionalText(200),
    creativeExternalRef: optionalText(200),
    consent: optionalText(200),
    doNotContact: optionalText(200),
    priorityBandCode: optionalText(200),
    requestedCatalogItemId: optionalText(200),
    requestedCatalogVersion: optionalText(200),
    utmSource: optionalText(200),
    utmMedium: optionalText(200),
    utmCampaign: optionalText(200),
    utmContent: optionalText(200),
    utmTerm: optionalText(200),
  })
  .strict();

export const csvImportRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    content: z.string().min(1).max(2 * 1024 * 1024),
    mapping: csvColumnMappingSchema,
    defaults: z
      .object({
        sourceKey: z.string().trim().min(1).max(120),
        campaignExternalRef: optionalText(200),
        creativeExternalRef: optionalText(200),
        priorityBandCode: z.enum(["P1", "P2", "P3"]).default("P3"),
      })
      .strict(),
  })
  .strict();

export type LeadEntryFields = z.output<typeof leadEntryFieldsSchema>;
export type CsvImportRequest = z.output<typeof csvImportRequestSchema>;

export function parseBrlToCents(value: string | undefined): number | undefined {
  if (!value) return undefined;

  let normalized = value.replace(/R\$/gi, "").replace(/\s/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Informe o orçamento em reais, por exemplo 6500,00.");
  }

  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("O orçamento informado está fora do limite aceito.");
  }
  return cents;
}

export function parseCsvBoolean(value: string | undefined): boolean | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLocaleLowerCase("pt-BR");
  if (["1", "sim", "s", "true", "verdadeiro"].includes(normalized)) return true;
  if (["0", "não", "nao", "n", "false", "falso"].includes(normalized)) return false;
  throw new Error(`Valor booleano inválido: ${value}.`);
}
