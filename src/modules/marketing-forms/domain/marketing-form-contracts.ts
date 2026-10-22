import { z } from "zod";

export const MARKETING_FORM_SCHEMA_VERSION = "marketing-form.v1" as const;

const stableKeySchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,79}$/);
export const marketingFormSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,119}$/);
const labelSchema = z.string().trim().min(1).max(240);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const marketingFormOptionSchema = z.object({
  stableKey: stableKeySchema,
  label: labelSchema,
}).strict();

const baseQuestionSchema = z.object({
  stableKey: stableKeySchema,
  title: z.string().trim().min(1).max(300),
  description: optionalText(1_000),
  required: z.boolean().default(false),
  position: z.number().int().min(0).max(199),
  mapping: z.enum([
    "fullName", "email", "phone", "jobTitle", "organizationName", "city", "stateCode",
    "interestSummary", "budgetCents", "contactPreference",
  ]).optional(),
});

const textConfigSchema = z.object({
  placeholder: optionalText(200),
  minLength: z.number().int().min(0).max(5_000).optional(),
  maxLength: z.number().int().min(1).max(5_000).default(300),
}).strict().refine((value) => value.minLength === undefined || value.minLength <= value.maxLength, {
  message: "O tamanho mínimo não pode superar o máximo.",
});

const questionSchemas = [
  baseQuestionSchema.extend({ type: z.literal("SHORT_TEXT"), config: textConfigSchema }).strict(),
  baseQuestionSchema.extend({ type: z.literal("LONG_TEXT"), config: textConfigSchema.safeExtend({ maxLength: z.number().int().min(1).max(10_000).default(2_000) }) }).strict(),
  baseQuestionSchema.extend({ type: z.literal("EMAIL"), config: z.object({ placeholder: optionalText(200) }).strict() }).strict(),
  baseQuestionSchema.extend({ type: z.literal("PHONE"), config: z.object({ placeholder: optionalText(200), defaultCountry: z.string().trim().toUpperCase().length(2).default("BR") }).strict() }).strict(),
  baseQuestionSchema.extend({ type: z.literal("NUMBER"), config: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().positive().finite().default(1) }).strict().refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max, { message: "O mínimo não pode superar o máximo." }) }).strict(),
  baseQuestionSchema.extend({ type: z.literal("DATE"), config: z.object({ min: z.string().date().optional(), max: z.string().date().optional() }).strict().refine((value) => !value.min || !value.max || value.min <= value.max, { message: "A data mínima não pode superar a máxima." }) }).strict(),
  baseQuestionSchema.extend({ type: z.literal("SINGLE_CHOICE"), config: z.object({ options: z.array(marketingFormOptionSchema).min(2).max(100) }).strict() }).strict(),
  baseQuestionSchema.extend({ type: z.literal("MULTIPLE_CHOICE"), config: z.object({ options: z.array(marketingFormOptionSchema).min(2).max(100), minSelections: z.number().int().min(0).default(0), maxSelections: z.number().int().min(1).max(100).optional() }).strict() }).strict(),
  baseQuestionSchema.extend({ type: z.literal("DROPDOWN"), config: z.object({ options: z.array(marketingFormOptionSchema).min(2).max(200), placeholder: optionalText(120) }).strict() }).strict(),
  baseQuestionSchema.extend({ type: z.literal("CHECKBOX"), config: z.object({ label: labelSchema }).strict() }).strict(),
] as const;

export const marketingFormQuestionSchema = z.discriminatedUnion("type", questionSchemas).superRefine((question, context) => {
  if ("options" in question.config) {
    const keys = question.config.options.map((option) => option.stableKey);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["config", "options"], message: "As opções precisam de chaves únicas." });
    if (question.type === "MULTIPLE_CHOICE" && question.config.maxSelections !== undefined && question.config.minSelections > question.config.maxSelections) {
      context.addIssue({ code: "custom", path: ["config", "maxSelections"], message: "O máximo precisa ser maior ou igual ao mínimo." });
    }
  }
});

const httpsUrlSchema = z.url().max(2_048).refine((value) => new URL(value).protocol === "https:", "Use uma URL HTTPS.");

export const marketingFormDefinitionSchema = z.object({
  schema: z.literal(MARKETING_FORM_SCHEMA_VERSION),
  questions: z.array(marketingFormQuestionSchema).min(1).max(200),
  thankYou: z.object({
    stableKey: stableKeySchema.default("obrigado"),
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(2_000),
    ctaLabel: optionalText(120),
    groupButtonLabel: optionalText(120),
  }).strict(),
  destination: z.object({
    sourceKey: stableKeySchema,
    pipelineId: z.string().uuid(),
    initialStageId: z.string().uuid(),
    tagIds: z.array(z.string().uuid()).max(20).default([]),
    queueId: z.string().uuid().nullable().optional(),
    priorityBandCode: z.enum(["P1", "P2", "P3"]).default("P3"),
  }).strict(),
  redirects: z.object({
    automaticKind: z.enum(["NONE", "GROUP", "WHATSAPP", "URL"]).default("NONE"),
    url: httpsUrlSchema.optional(),
    whatsapp: z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/), message: optionalText(1_000) }).strict().optional(),
    group: z.object({ url: httpsUrlSchema.refine((value) => new URL(value).hostname === "chat.whatsapp.com", "Use um link de grupo do WhatsApp."), label: optionalText(120) }).strict().optional(),
    rotation: z.object({ targets: z.array(z.object({ stableKey: stableKeySchema, phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/), label: optionalText(120) }).strict()).min(2).max(50) }).strict().optional(),
  }).strict().default({ automaticKind: "NONE" }),
  style: z.object({
    title: optionalText(200),
    ctaColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
    questionColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f172a"),
    answerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#334155"),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
    font: z.enum(["INTER", "SYSTEM", "SERIF"]).default("INTER"),
    radius: z.enum(["NONE", "SM", "MD", "LG", "PILL"]).default("MD"),
    alignment: z.enum(["LEFT", "CENTER"]).default("LEFT"),
    logoUrl: httpsUrlSchema.optional(),
    backgroundImageUrl: httpsUrlSchema.optional(),
  }).strict(),
  tracking: z.object({
    internalEvents: z.literal(true),
    meta: z.object({ enabled: z.boolean(), pixelId: optionalText(80), connectionId: z.string().uuid().optional(), secretReferenceKey: z.string().trim().regex(/^META_[A-Z0-9_]{3,120}$/).optional() }).strict().optional(),
    google: z.object({ enabled: z.boolean(), conversionId: optionalText(80), conversionLabel: optionalText(120), connectionId: z.string().uuid().optional(), secretReferenceKey: z.string().trim().regex(/^GOOGLE_[A-Z0-9_]{3,120}$/).optional() }).strict().optional(),
  }).strict().default({ internalEvents: true }),
  sharing: z.object({
    defaultUtmSource: optionalText(200),
    defaultUtmMedium: optionalText(200),
    defaultUtmCampaign: optionalText(300),
  }).strict().default({}),
}).strict().superRefine((definition, context) => {
  const questionKeys = definition.questions.map((question) => question.stableKey);
  const positions = definition.questions.map((question) => question.position);
  if (new Set(questionKeys).size !== questionKeys.length) context.addIssue({ code: "custom", path: ["questions"], message: "As perguntas precisam de chaves únicas." });
  if (new Set(positions).size !== positions.length) context.addIssue({ code: "custom", path: ["questions"], message: "As posições precisam ser únicas." });
  const mappings = definition.questions.flatMap((question) => question.mapping ? [question.mapping] : []);
  if (new Set(mappings).size !== mappings.length) context.addIssue({ code: "custom", path: ["questions"], message: "Cada campo canônico do CRM pode ser mapeado uma vez." });
  if (definition.redirects.automaticKind === "GROUP" && !definition.redirects.group) context.addIssue({ code: "custom", path: ["redirects", "group"], message: "Informe o grupo para o redirecionamento automático." });
  if (definition.redirects.automaticKind === "WHATSAPP" && !definition.redirects.whatsapp && !definition.redirects.rotation) context.addIssue({ code: "custom", path: ["redirects"], message: "Informe WhatsApp individual ou rotação." });
  if (definition.redirects.automaticKind === "URL" && !definition.redirects.url) context.addIssue({ code: "custom", path: ["redirects", "url"], message: "Informe a URL de redirecionamento." });
  if (definition.tracking.meta?.enabled && !definition.tracking.meta.pixelId) context.addIssue({ code: "custom", path: ["tracking", "meta", "pixelId"], message: "Informe o Pixel ID ao ativar Meta." });
  if (definition.tracking.google?.enabled && (!definition.tracking.google.conversionId || !definition.tracking.google.conversionLabel)) context.addIssue({ code: "custom", path: ["tracking", "google"], message: "Informe o ID e o rótulo da conversão ao ativar Google Ads." });
  if (definition.tracking.meta?.secretReferenceKey && !definition.tracking.meta.connectionId) context.addIssue({ code: "custom", path: ["tracking", "meta", "connectionId"], message: "Selecione a conexão da referência Meta." });
  if (definition.tracking.google?.secretReferenceKey && !definition.tracking.google.connectionId) context.addIssue({ code: "custom", path: ["tracking", "google", "connectionId"], message: "Selecione a conexão da referência Google Ads." });
});

export const createMarketingFormSchema = z.object({
  name: z.string().trim().min(2).max(160),
  publicSlug: marketingFormSlugSchema,
}).strict();

export const updateMarketingFormSchema = z.object({
  name: z.string().trim().min(2).max(160),
  expectedRevision: z.number().int().positive(),
  definition: marketingFormDefinitionSchema,
}).strict();

export const marketingFormActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PUBLISH"), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("PAUSE"), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("ACTIVATE"), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("ARCHIVE"), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("DUPLICATE"), name: z.string().trim().min(2).max(160), publicSlug: marketingFormSlugSchema }).strict(),
]);

export type MarketingFormDefinition = z.infer<typeof marketingFormDefinitionSchema>;
export type MarketingFormQuestion = z.infer<typeof marketingFormQuestionSchema>;

export function createEmptyMarketingFormDefinition(): MarketingFormDefinition {
  return marketingFormDefinitionSchema.parse({
    schema: MARKETING_FORM_SCHEMA_VERSION,
    questions: [{ stableKey: "nome-completo", type: "SHORT_TEXT", title: "Qual o seu nome completo?", required: true, position: 0, mapping: "fullName", config: { maxLength: 160 } }],
    thankYou: { stableKey: "obrigado", title: "Obrigado!", message: "Recebemos suas respostas." },
    destination: { sourceKey: "formulario", pipelineId: "00000000-0000-4000-8000-000000000000", initialStageId: "00000000-0000-4000-8000-000000000000", tagIds: [], priorityBandCode: "P3" },
    redirects: { automaticKind: "NONE" },
    style: {},
    tracking: { internalEvents: true },
    sharing: {},
  });
}
